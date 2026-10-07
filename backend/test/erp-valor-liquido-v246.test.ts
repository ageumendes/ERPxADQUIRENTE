import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { preencherValorLiquidoErp } from '../src/database/erp-valor-liquido.js';

test('líquido legado vem do original sem modificar bruto, hash, original ou conciliação; repetição segura', async()=>{
  const db=new PGlite();
  try {
    await db.query('CREATE TABLE vendas_interdata(pk serial PRIMARY KEY,dados jsonb NOT NULL)');
    const registros=[
      {valor_bruto:'42.68',hash_linha:'hash-original',conciliacao_id:'confirmada',dados_originais:{'Vlr. Liquido':'42.21052','Vlr. Parcela':'42.68'}},
      {valor_bruto:'10',valor_liquido:'9.5',dados_originais:{'Vlr. Liquido':'8'}},
      {valor_bruto:'5',dados_originais:{'Vlr. Líquido':'0'}},
      {valor_bruto:'20',dados_originais:{'Vlr. Liquido':''}},
      {valor_bruto:'30',dados_originais:{}},
    ];
    for(const dados of registros) await db.query('INSERT INTO vendas_interdata(dados) VALUES($1::jsonb)',[JSON.stringify(dados)]);
    const pool={query:(sql:string)=>db.query(sql)};
    await preencherValorLiquidoErp(pool);await preencherValorLiquidoErp(pool);
    const {rows}=await db.query<{dados:Record<string,unknown>}>('SELECT dados FROM vendas_interdata ORDER BY pk');
    assert.deepEqual(rows.map(r=>r.dados),[
      {...registros[0],valor_liquido:'42.21052'},registros[1],{...registros[2],valor_liquido:'0'},registros[3],registros[4],
    ]);
  } finally {await db.close();}
});
