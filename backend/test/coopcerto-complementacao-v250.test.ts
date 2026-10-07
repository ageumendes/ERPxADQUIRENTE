import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {aplicarSchemaBanco} from '../src/database/bootstrap.js';
import {chaveSemanticaCoopcerto,planejarAtualizacoesCoopcerto} from '../src/services/coopcerto-upsert.js';
import {planejarCorrecao} from '../src/services/correcao-vendas.js';
import {capturaVoucher,economicaVoucher,selecionarParesVoucher} from '../src/services/voucher-pares.js';
import type {VendaAdquirente} from '../src/repositories/repositorio.js';
const venda=(id:string,autorizada=false,patch:any={}):VendaAdquirente=>({
 id,importacao_id:'imp-'+id,hash_linha:'hash-'+id,adquirente:'COOPCERTO',layout_origem:'coopcerto_cabal_vendas_csv',tipo_arquivo:'COOPCERTO_CABAL_VENDAS_CSV',
 data_venda:'2026-10-01',hora_venda:'18:13:11',codigo_estabelecimento:'NBO',valor_bruto:'29.98',valor_taxa:autorizada?'1.05':'0.00',valor_liquido:autorizada?'28.93':'29.98',
 percentual_taxa:autorizada?'3.5000':'0.0000',modalidade:'VOUCHER',bandeira:'CABAL',parcelas:'1/1',nsu:autorizada?'3969069876':'',codigo_autorizacao:autorizada?'12345':'',
 status_transacao:autorizada?'AUTORIZADO':'PENDENTE',dados_json:{'Nº do estabelecimento':'LOJA-NBO',id_venda_rrn:'RRN-1'},...patch
} as VendaAdquirente);
const row=(v:VendaAdquirente)=>({row_id:v.id,dados:v,conciliacao_id:null});
test('legado identificado pelo layout complementa pendente sem chave persistida',()=>{
 const p=venda('p',false,{tipo_arquivo:undefined});const a=venda('a',true);
 assert.equal(chaveSemanticaCoopcerto(p),chaveSemanticaCoopcerto(a));
 const plano=planejarAtualizacoesCoopcerto([row(p)],[a]);assert.equal(plano.novos.length,0);assert.equal(plano.updates.get('p')?.status_transacao,'AUTORIZADO');
 assert.equal(plano.updates.get('p')?.valor_liquido,'28.93');assert.equal(plano.updates.get('p')?.id,'p');
 assert.equal(planejarAtualizacoesCoopcerto([row(a)],[p]).updates.size,0);
});
test('mesmo RRN com bruto/data divergentes ou dois registros referenciados bloqueia atualização',()=>{
 const p=venda('p'),a=venda('a',true);
 for(const patch of [{valor_bruto:'39.98'},{data_venda:'2026-10-02'}]){
  const plano=planejarAtualizacoesCoopcerto([row(p)],[{...a,...patch}]);assert.equal(plano.conflitos,1);assert.equal(plano.novos.length,0);assert.equal(plano.updates.size,0);
 }
 const plano=planejarAtualizacoesCoopcerto([{...row(p),referenciado:true},{...row(a),referenciado:true}],[a]);assert.equal(plano.conflitos,1);assert.equal(plano.substituidos.size,0);
});
test('prévia COOPCERTO preserva originais e suprime somente a cópia sem vínculo',()=>{
 const p=venda('p'),a=venda('a',true);const rows=[row(p),row(a)];const antes=JSON.stringify(rows);
 const plano=planejarCorrecao(rows,[],'coopcerto');assert.equal(plano.grupos.length,1);assert.equal(plano.alteracoes.filter(v=>v.depois===null).length,0);
 const principal=plano.alteracoes.find(v=>v.id===plano.grupos[0].manter)?.depois||rows.find(v=>v.row_id===plano.grupos[0].manter)?.dados;
 assert.equal(principal?.status_transacao,'AUTORIZADO');assert.equal(principal?.valor_liquido,'28.93');assert.equal(JSON.stringify(rows),antes);
 const conflito=planejarCorrecao(rows,[{venda_adquirente_id:'p'},{venda_adquirente_id:'a'}],'coopcerto');assert.equal(conflito.alteracoes.length,0);assert.equal(conflito.bloqueados.length,1);
 const financeiro=planejarCorrecao([row(a),row(venda('b',true,{valor_liquido:'28.00'}))],[],'coopcerto');assert.equal(financeiro.alteracoes.length,0);
});
test('origem SIPAG permanece captura mesmo com adquirente convertido para COOPCERTO',()=>{
 const financeira=venda('f',true);const captura=venda('s',true,{layout_origem:'sipag_layout_2_0',tipo_arquivo:'SIPAG',valor_taxa:'0.00',valor_liquido:'29.98'});
 assert.ok(capturaVoucher(captura));assert.equal(economicaVoucher(captura),false);
 const par=selecionarParesVoucher([captura],[financeira]);assert.equal(par[0].status,'VINCULADO');assert.equal(par[0].economica?.id,'f');
 assert.equal(selecionarParesVoucher([captura],[financeira,{...financeira,id:'f2'}])[0].status,'AMBIGUO');
 assert.equal(selecionarParesVoucher([captura],[{...financeira,codigo_estabelecimento:'SRG'}])[0].status,'SEM_VINCULO');
});
test('SQL: busca RRN legado sem chave gravada, mantém um ID e não duplica relatórios repetidos',async()=>{
 const pg=new PGlite();const old={query:Pool.prototype.query,connect:Pool.prototype.connect,end:Pool.prototype.end};
 const query=async(sql:string,params:any[]=[])=>{const r=await pg.query(sql,params);return {rows:r.rows as any[],rowCount:r.rows.length||r.affectedRows||0};};
 (Pool.prototype as any).query=query;(Pool.prototype as any).connect=async()=>({query,release(){}});(Pool.prototype as any).end=async()=>{};
 process.env.DATABASE_URL='postgresql://teste:teste@localhost/coop250_isolado';
 try {
  await aplicarSchemaBanco({query} as any);const repo=await import('../src/repositories/repositorio.js');
  const p=venda('pendente',false,{tipo_arquivo:undefined}),a=venda('autorizada',true);
  await query('INSERT INTO vendas_adquirentes(row_id,hash_linha,dados) VALUES($1,$2,$3::jsonb)',[p.id,p.hash_linha,JSON.stringify(p)]);
  const atual=await repo.salvarVendasAdquirentes([a]);assert.equal(atual.inseridos,0);assert.equal(atual.atualizados,1);
  const rows=(await query('SELECT row_id,dados FROM vendas_adquirentes')).rows;assert.equal(rows.length,1);assert.equal(rows[0].row_id,'pendente');assert.equal(rows[0].dados.status_transacao,'AUTORIZADO');assert.equal(rows[0].dados.valor_liquido,'28.93');
  assert.equal((await repo.salvarVendasAdquirentes([a])).inseridos,0);
  await repo.salvarVendasAdquirentes([p]);assert.equal((await query('SELECT dados FROM vendas_adquirentes')).rows[0].dados.status_transacao,'AUTORIZADO');
  const antiga=venda('copia-antiga');
  await query('INSERT INTO vendas_adquirentes(row_id,hash_linha,dados) VALUES($1,$2,$3::jsonb)',[antiga.id,antiga.hash_linha,JSON.stringify(antiga)]);
  const correcao=await import('../src/services/correcao-vendas.js');
  const plano=await correcao.simularCorrecao('coopcerto');assert.equal(plano.grupos.length,1);
  assert.equal((await query("SELECT COUNT(*)::int n FROM vendas_adquirentes WHERE dados->>'utilidade_status'='NAO_UTIL'")).rows[0].n,0,'prévia não grava');
  const aplicada=await correcao.aplicarCorrecao(correcao.resumoPlano(plano));assert.ok(aplicada.execucao);assert.equal(aplicada.removidos,0);
  assert.equal((await query('SELECT COUNT(*)::int n FROM vendas_adquirentes')).rows[0].n,2,'originais permanecem no banco');
  assert.equal((await query("SELECT COUNT(*)::int n FROM vendas_adquirentes WHERE dados->>'utilidade_status'='NAO_UTIL'")).rows[0].n,1);
  const candidatos=await repo.listarCandidatosConciliacaoManual('ADQUIRENTE',80,0);assert.equal(candidatos.total_linhas,1,'cópia suprimida não pode reaparecer na conciliação manual');
  await correcao.desfazerCorrecao(aplicada.execucao!);
  assert.equal((await query("SELECT COUNT(*)::int n FROM vendas_adquirentes WHERE dados->>'utilidade_status'='NAO_UTIL'")).rows[0].n,0);

 }finally{Object.assign(Pool.prototype,old);await pg.close();}
});
