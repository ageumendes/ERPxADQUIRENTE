import {avaliarCandidatoHibrido} from '../src/services/conciliacao-hibrida.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {aplicarSchemaBanco} from '../src/database/bootstrap.js';
import {planejarAgrupamentosSipag} from '../src/services/erp-parcelas-sipag.js';
const base={cnpj_estabelecimento:'SRG',data_venda:'01/10/2026',hora_venda:'19:20:00',nsu:'500327',tipo_produto:'CREDITO',bandeira:'VISA',id_venda_erp:'VENDA-1',valor_bruto:'274.93',valor_liquido:'263.49'};
const erps=[{...base,id:'p1',parcelas:'1/2'},{...base,id:'p2',parcelas:'2/2'}];
const adq={id:'a1',adquirente:'SIPAG',codigo_estabelecimento:'SRG',data_venda:'2026-10-01',hora_venda:'20:20:23',nsu:'500327',modalidade:'CREDITO',bandeira:'VISA',parcelas:'2/2',status_transacao:'AUTORIZADO',valor_bruto:'549.86',valor_liquido:'535.50'};
test('grupo SIPAG completo soma bruto/líquido sem mudar os originais e preserva precisão',()=>{
  const antes=JSON.stringify(erps);const p=planejarAgrupamentosSipag(erps,[adq]);assert.equal(p.length,1);
  assert.equal(p[0].dados.valor_bruto,'549.86');assert.equal(p[0].dados.valor_liquido,'526.98');assert.equal(JSON.stringify(erps),antes);
  assert.equal(planejarAgrupamentosSipag(erps.map(v=>({...v,valor_liquido:'263.49052'})),[adq])[0].dados.valor_liquido,'526.98104');
});
test('parcela isolada SIPAG permanece bloqueada mesmo se coincidir com o valor total',()=>{
  assert.equal(avaliarCandidatoHibrido(adq,{...erps[0],valor_bruto:adq.valor_bruto}),null);
});
test('não agrupa parcelas incompletas, repetidas, lojas, datas, valores, vendas ou modalidades divergentes',()=>{
  const casos=[erps.slice(0,1),[erps[0],erps[0]],erps.map((v,i)=>({...v,cnpj_estabelecimento:i?'NBO':'SRG'})),erps.map((v,i)=>({...v,data_venda:i?'02/10/2026':'01/10/2026'})),erps.map((v,i)=>({...v,id_venda_erp:i?'OUTRA':'VENDA-1'})),erps.map((v,i)=>({...v,parcelas:i?'2/3':'1/2'})),erps.map((v,i)=>({...v,valor_bruto:i?'275.00':'274.93'})),erps.map((v,i)=>({...v,tipo_produto:i?'DEBITO':'CREDITO'})),erps.map((v,i)=>({...v,_nao_aplica:!!i})),erps.map((v,i)=>({...v,conciliacao_id:i?'existente':null}))];
  for(const c of casos)assert.equal(planejarAgrupamentosSipag(c,[adq]).length,0,JSON.stringify(c));
  assert.equal(planejarAgrupamentosSipag(erps,[{...adq,adquirente:'CIELO'}]).length,0);
  assert.equal(planejarAgrupamentosSipag(erps,[adq,{...adq,id:'a2'}]).length,0);
  assert.equal(planejarAgrupamentosSipag([...erps,...erps.map(v=>({...v,id:v.id+'outro',id_venda_erp:'VENDA-2'}))],[adq]).length,0);
});
test('SQL real: agrupamento idempotente, totais únicos, automático, desfazer, confirmar manual e revalidar',async()=>{
  const pg=new PGlite();const old={query:Pool.prototype.query,connect:Pool.prototype.connect,end:Pool.prototype.end};
  const consultas:string[]=[];
  const query=async(sql:string,params:unknown[]=[])=>{consultas.push(sql);const r=await pg.query(sql,params);return {rows:r.rows as any[],rowCount:r.rows.length||r.affectedRows||0};};
  (Pool.prototype as any).query=query;(Pool.prototype as any).connect=async()=>({query,release(){}});(Pool.prototype as any).end=async()=>{};
  process.env.DATABASE_URL='postgresql://teste:teste@localhost/erp247_isolado';
  try {
    await aplicarSchemaBanco({query} as any);const repo=await import('../src/repositories/repositorio.js');
    const originais=erps.map(v=>({...v,importacao_id:'orig',hash_linha:v.id,dados_originais:{'Vlr. Parcela':v.valor_bruto,'Vlr. Liquido':v.valor_liquido}}));
    for(const e of originais)await query('INSERT INTO vendas_interdata(row_id,hash_linha,dados) VALUES($1,$1,$2::jsonb)',[e.id,JSON.stringify(e)]);
    await query('INSERT INTO vendas_adquirentes(row_id,hash_linha,dados) VALUES($1,$1,$2::jsonb)',[adq.id,JSON.stringify({...adq,nsu:'00500327',hash_linha:adq.id})]);
    await repo.sincronizarParcelasErpSipag(true);
    const antesRepetir=consultas.length;
    await repo.sincronizarParcelasErpSipag(true);
    assert.ok(!consultas.slice(antesRepetir).some(sql=>/^UPDATE vendas_interdata SET dados/.test(sql)),'sincronização intacta não deve regravar parcelas/grupo');
    const {rows:g}=await query("SELECT dados FROM vendas_interdata WHERE dados->>'origem_erp'='AGRUPAMENTO_PARCELAS_SIPAG'");assert.equal(g.length,1);const id=g[0].dados.id;
    const inicioLeituras=consultas.length;
    const agora=Date.now;Date.now=()=>agora()+10_000;
    try {
    const listagem=await repo.listarVendasErpComExibicao(500,0,{});assert.equal(listagem.total_linhas,1);assert.equal(listagem.linhas.reduce((s:number,v:any)=>s+Number(v.valor_bruto),0),549.86);
    const pendentes=await repo.listarCandidatosConciliacaoManual('ERP',80,0);assert.equal(pendentes.linhas.length,1);assert.equal(pendentes.linhas[0].valor_bruto,'549.86');
    await repo.listarCandidatosConciliacaoManual('ADQUIRENTE',80,0);
    assert.ok(!consultas.slice(inicioLeituras).some(sql=>sql.includes('pg_advisory_xact_lock(247,1)')||sql.includes('AS nao_aplica FROM vendas_interdata')),'consultas de leitura não podem executar sincronização global');
    } finally {Date.now=agora;}
    await assert.rejects(repo.criarConciliacaoManual('p1','a1','tentativa isolada'),/Parcela reservada|parcela isolada bloqueada/);
    const auto=await repo.executarConciliacaoAutomatica({});assert.ok(Number((auto as any).conciliados)>=1,JSON.stringify(auto));
    const c=(await query("SELECT row_id,dados,status FROM conciliacoes WHERE venda_interdata_id=$1 AND status='CONCILIADO'",[id])).rows[0];assert.ok(c,JSON.stringify({auto,grupos:(await query('SELECT row_id,dados FROM vendas_interdata')).rows,concs:(await query('SELECT row_id,status,dados FROM conciliacoes')).rows}));
    assert.deepEqual(c.dados.ids_parcelas_erp,['p1','p2']);
    const segunda=await repo.executarConciliacaoAutomatica({});assert.equal(Number((segunda as any).conciliados),0);
    assert.equal((await query("SELECT COUNT(*)::int AS n FROM conciliacoes WHERE status='CONCILIADO'")).rows[0].n,1);
    assert.equal((await query("SELECT detalhes FROM historico_conciliacoes WHERE conciliacao_id=$1 AND acao='VINCULO_PARCELAS_ERP'",[c.row_id])).rows[0].detalhes.ids_parcelas_erp.length,2);
    const filhos=(await query("SELECT row_id,conciliacao_id,dados FROM vendas_interdata WHERE row_id IN ('p1','p2') ORDER BY row_id")).rows;
    for(let i=0;i<filhos.length;i++){assert.equal(filhos[i].conciliacao_id,null);assert.equal(filhos[i].dados.conciliacao_agrupamento_id,c.row_id);assert.equal(filhos[i].dados.status_agrupamento,'CONCILIADO');assert.equal(filhos[i].dados.valor_bruto,'274.93');assert.deepEqual(filhos[i].dados.dados_originais,originais[i].dados_originais);}
    await repo.verificarDuplicidadesImportacao({aplicar:true});
    assert.equal((await query("SELECT COUNT(*)::int AS n FROM vendas_interdata WHERE row_id IN ('p1','p2')")).rows[0].n,2);
    await repo.desfazerConciliacao(c.row_id,'revisar agrupamento');
    assert.ok((await query("SELECT dados FROM vendas_interdata WHERE row_id IN ('p1','p2')")).rows.every(r=>r.dados.conciliacao_agrupamento_id===null&&r.dados.status_agrupamento==='PENDENTE'));
    // Uma venda concorrente com o mesmo NSU precisa continuar bloqueando a
    // confirmação mesmo quando a revalidação consulta apenas esse NSU.
    for(const e of originais)await query('INSERT INTO vendas_interdata(row_id,hash_linha,dados) VALUES($1,$1,$2::jsonb)',[e.id+'concorrente',JSON.stringify({...e,id:e.id+'concorrente',id_venda_erp:'OUTRA-VENDA'})]);
    await assert.rejects(repo.criarConciliacaoManual(id,'a1','ambiguidade'),/Parcelas alteradas/);
    await query("DELETE FROM vendas_interdata WHERE row_id IN ('p1concorrente','p2concorrente')");
    const manual=await repo.criarConciliacaoManual(id,'a1','conferido grupo inteiro');assert.equal(manual.conciliacao.status,'CONCILIADO');
    await repo.desfazerConciliacao(manual.conciliacao.id,'validar alteração');
    await query("UPDATE vendas_interdata SET dados=dados||'{\"valor_bruto\":\"270.00\"}'::jsonb WHERE row_id='p2'");
    await assert.rejects(repo.criarConciliacaoManual(id,'a1','grupo desatualizado'),/Parcelas alteradas/);
    await repo.sincronizarParcelasErpSipag(true);
    assert.ok((await query("SELECT dados FROM vendas_interdata WHERE row_id IN ('p1','p2')")).rows.every(r=>!r.dados.agrupamento_erp_id));
  } finally {Object.assign(Pool.prototype,old);await pg.close();}
});
