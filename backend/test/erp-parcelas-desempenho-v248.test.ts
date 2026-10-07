import assert from 'node:assert/strict';
import test from 'node:test';
import {planejarAgrupamentosSipag} from '../src/services/erp-parcelas-sipag.js';
test('índice SIPAG encontra cinco mil vendas completas sem cruzar NSUs e mantém ambiguidade bloqueada',()=>{
  const erps:any[]=[];const adqs:any[]=[];
  for(let i=0;i<5000;i++){
    const base={cnpj_estabelecimento:'SRG',data_venda:'01/10/2026',hora_venda:'19:20:00',nsu:String(i+1),tipo_produto:'CREDITO',bandeira:'VISA',id_venda_erp:'v'+i,valor_bruto:'100.00',valor_liquido:'95.00'};
    erps.push({...base,id:'p1-'+i,parcelas:'1/2'},{...base,id:'p2-'+i,parcelas:'2/2'});
    adqs.push({id:'a'+i,adquirente:'SIPAG',codigo_estabelecimento:'SRG',data_venda:'2026-10-01',nsu:String(i+1).padStart(8,'0'),modalidade:'CREDITO',bandeira:'VISA',parcelas:'2/2',status_transacao:'AUTORIZADO',valor_bruto:'200.00'});
  }
  const planos=planejarAgrupamentosSipag(erps,[...adqs,{...adqs[0],id:'duplicada'}]);
  assert.equal(planos.length,4999);
  assert.equal(new Set(planos.map(p=>p.adquirente_id)).size,4999);
  assert.ok(planos.every(p=>p.dados.valor_bruto==='200.00'&&p.dados.valor_liquido==='190.00'&&p.itens.every(e=>e.nsu===p.dados.nsu)));
});
