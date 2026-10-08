import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { aplicarSchemaBanco } from '../src/database/bootstrap.js';

test('SQL em lote concilia base sintética e exclui lojas, status, valores e NÃO APLICA incompatíveis', async () => {
  const pg=new PGlite();
  const old={query:Pool.prototype.query,connect:Pool.prototype.connect,end:Pool.prototype.end};
  const query=async(sql:string,params:unknown[]=[])=>{const r=await pg.query(sql,params);return {rows:r.rows as any[],rowCount:r.rows.length||r.affectedRows||0};};
  (Pool.prototype as any).query=query;
  (Pool.prototype as any).connect=async()=>({query,release(){}});
  (Pool.prototype as any).end=async()=>{};
  process.env.DATABASE_URL='postgresql://teste:teste@localhost/v252_isolado';
  try {
    await aplicarSchemaBanco({query} as any);
    const erps=Array.from({length:600},(_,i)=>({id:'e'+i,cnpj_estabelecimento:'SRG',data_venda:'2026-10-01',hora_venda:'12:00:00',tipo_produto:'CREDITO',bandeira:'VISA',parcelas:'1/1',valor_bruto:(i+1)+'.00',nsu:String(i+1000)}));
    const adqs=Array.from({length:6000},(_,i)=>({id:'a'+i,codigo_estabelecimento:'SRG',adquirente:'SIPAG',data_venda:'2026-10-01',hora_venda:'12:00:00',modalidade:'CREDITO',bandeira:'VISA',parcelas:'1/1',status_transacao:'AUTORIZADO',valor_bruto:(i+1)+'.00',nsu:String(i+1000)}));
    Object.assign(adqs[0],{codigo_estabelecimento:'NBO'});
    Object.assign(adqs[1],{status_transacao:'PENDENTE'});
    Object.assign(adqs[2],{pagador_documento:'NÃO APLICA'});
    Object.assign(adqs[3],{valor_bruto:'0.00'});
    Object.assign(adqs[4],{data_venda:'2026-10-04'});
    for(const [tabela,rows] of [['vendas_interdata',erps],['vendas_adquirentes',adqs]] as const)
      await query(`INSERT INTO ${tabela}(row_id,hash_linha,dados) SELECT item->>'id',item->>'id',item FROM jsonb_array_elements($1::jsonb) item`,[JSON.stringify(rows)]);
    const repo=await import('../src/repositories/repositorio.js');
    const result:any=await repo.executarConciliacaoAutomatica({simular:true,tamanhoLote:500});
    assert.equal(result.avaliados.vendas_interdata,600);
    assert.equal(result.avaliados.pares_candidatos,595);
    assert.equal(result.conciliados,595);
    const fora:any=await repo.executarConciliacaoAutomatica({simular:true,dataInicial:'2026-10-02',dataFinal:'2026-10-08'});
    assert.equal(fora.avaliados.vendas_interdata,0,'não varre ERP anterior à janela');
    const inclusivo:any=await repo.executarConciliacaoAutomatica({simular:true,dataInicial:'2026-10-01',dataFinal:'2026-10-01'});
    assert.equal(inclusivo.conciliados,595,'datas inicial e final são inclusivas');
    const concorrente={...erps[10],id:'erp-fronteira',data_venda:'2026-09-30'};
    await query('INSERT INTO vendas_interdata(row_id,hash_linha,dados) VALUES($1,$1,$2::jsonb)',[concorrente.id,JSON.stringify(concorrente)]);
    const fronteira:any=await repo.executarConciliacaoAutomatica({simular:true,dataInicial:'2026-10-01',dataFinal:'2026-10-01'});
    assert.equal(fronteira.conciliados,594,'um ERP concorrente fora do lote impede confirmação indevida');
    assert.equal(fronteira.avaliados.vendas_interdata,600,'registros de contexto não contam como execução fora do período');
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM conciliacoes')).rows[0].n,0,'simulação não persiste vínculos');
    console.log(`[teste-v252] ERP=600 ADQ=6000 pares=595 duracao_ms=${result.duracao_ms}`);
  } finally {Object.assign(Pool.prototype,old);await pg.close();}
});
