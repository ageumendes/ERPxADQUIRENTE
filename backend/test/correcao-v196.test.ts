import test from 'node:test';
import assert from 'node:assert/strict';
import { planejarCorrecao } from '../src/services/correcao-vendas.js';
import { chaveVenda,centavosVenda } from '../src/services/identidade-venda.js';
import { avaliarParVoucher } from '../src/services/voucher-pares.js';
const sale=(id:string,patch:Record<string,any>={}):Record<string,any>=>({pk:Number(id)||1,row_id:id,hash_linha:'hash-'+id,hash_arquivo:'',conciliacao_id:null,dados:{id,adquirente:'SIPAG',codigo_estabelecimento:'SRG',data_venda:'2026-08-20',hora_venda:'10:47:59',valor_bruto:'17.99',valor_taxa:'0.27',valor_liquido:'17.72',codigo_autorizacao:'0264574',nsu:'different-'+id,parcelas:'1/1',modalidade:'CREDITO',bandeira:'MASTERCARD',status_transacao:'AUTORIZADO',layout_origem:'sipag_extrato_vendas_realizadas',...patch}});
test('complementa financeiro sem perder identidade conciliada e preserva snapshots',()=>{
 const a=sale('1',{layout_origem:'sipag_extrato_transacoes_autorizadas',valor_taxa:'0.00',valor_liquido:'17.99',conciliacao_id:'c1'}),b=sale('2',{codigo_estabelecimento:'106145980001',parcelas:'1x',codigo_autorizacao:'264574'});
 a.conciliacao_id='c1';const p=planejarCorrecao([a,b],[{row_id:'c1',venda_adquirente_id:'1'}]);
 assert.equal(p.grupos.length,1);assert.equal(p.grupos[0].manter,'1');assert.equal(p.alteracoes.find(x=>x.id==='1')!.depois!.valor_taxa,'0.27');assert.equal(p.alteracoes.find(x=>x.id==='2')!.antes.dados,b.dados);
 const after=p.alteracoes.filter(x=>x.depois).map(x=>({...x.antes,dados:x.depois}));assert.equal(planejarCorrecao(after,[{row_id:'c1',venda_adquirente_id:'1'}]).grupos.length,0);
});
test('bloqueia referências em duas vendas mesmo sem conciliacao_id no JSON',()=>{
 const p=planejarCorrecao([sale('1'),sale('2')],[{row_id:'c1',venda_adquirente_id:'1'},{row_id:'c2',venda_adquirente_id:'2',status:'AMBIGUO'}]);assert.equal(p.grupos.length,0);assert.equal(p.bloqueados.length,1);
});
test('não escolhe a maior taxa em divergência financeira',()=>{
 const p=planejarCorrecao([sale('1'),sale('2',{valor_taxa:'0.50',valor_liquido:'17.49'})],[]);assert.equal(p.bloqueados[0].motivo,'FONTES_FINANCEIRAS_DIVERGENTES');
});
test('bloqueia finais de cartão distintos dentro da mesma adquirente',()=>{
 const p=planejarCorrecao([sale('1',{dados_json:{'Nº cartão':'550209******1234'}}),sale('2',{dados_json:{'Nº cartão':'550209******4567'}})],[]);assert.equal(p.grupos.length,0);
});
test('loja, status, parcela e hora diferentes não são descartados',()=>{
 for(const patch of [{codigo_estabelecimento:'NBO'},{status_transacao:'CANCELADO'},{parcelas:'2/2'},{hora_venda:'10:48:00'}])assert.equal(planejarCorrecao([sale('1'),sale('2',patch)],[]).grupos.length,0);
 assert.equal(chaveVenda(sale('1',{codigo_estabelecimento:''}).dados),'');
 assert.equal(chaveVenda(sale('1',{codigo_autorizacao:'000',nsu:''}).dados),'');
});
test('centavos exatos e parcelas desconhecidas',()=>{
 assert.equal(centavosVenda('30.960000'),3096);assert.equal(centavosVenda('30.961'),null);assert.equal(chaveVenda(sale('1',{parcelas:''}).dados),'');
});
test('plano estável e impossibilidade de misturar operadoras',()=>{
 const a=sale('1'),b=sale('2');assert.deepEqual(planejarCorrecao([a,b],[]),planejarCorrecao([a,b],[]));
 assert.equal(planejarCorrecao([a,sale('2',{adquirente:'CIELO'})],[]).grupos.length,0);assert.throws(()=>planejarCorrecao([a,b],[],'duplicidades',0));
});
test('voucher preserva taxas da operadora e ambas as origens e é idempotente',()=>{
 const a=sale('1',{modalidade:'VOUCHER',bandeira:'PLUXEE',codigo_estabelecimento:'106145980001',valor_taxa:'0.00',valor_liquido:'17.99'}),b=sale('2',{adquirente:'PLUXEE',modalidade:'VOUCHER',bandeira:'PLUXEE',layout_origem:'pluxee_ceadm10'});
 const p=planejarCorrecao([a,b],[],'vouchers');assert.equal(p.grupos.length,1);assert.equal(p.alteracoes.filter(x=>!x.depois).length,0);assert.equal(p.alteracoes.find(x=>x.id==='1')!.depois!.suprimido_por_vinculo_voucher,true);
 const after=p.alteracoes.map(x=>({...x.antes,dados:x.depois}));assert.equal(planejarCorrecao(after,[],'vouchers').grupos.length,0);
});
test('voucher bloqueia captura com histórico e disputa 2 para 1',()=>{
 const a=sale('1',{modalidade:'VOUCHER',bandeira:'PLUXEE'}),b=sale('2',{adquirente:'PLUXEE',modalidade:'VOUCHER',bandeira:'PLUXEE'});
 assert.equal(planejarCorrecao([a,b],[{row_id:'c',venda_adquirente_id:'1'}],'vouchers').grupos.length,0);
 assert.equal(planejarCorrecao([a,{...a,row_id:'3',dados:{...a.dados,id:'3'}},b],[],'vouchers').grupos.length,0);
});
test('CIELO E de venda não é estorno; ALELO aceita zeros decimais',()=>{
 const a=sale('1',{adquirente:'CIELO',codigo_registro:'E',layout_origem:'cielo_layout_15_15_cielo03',modalidade:'VOUCHER',bandeira:'ALELO',valor_bruto:'30.96'}).dados;
 const b=sale('2',{adquirente:'ALELO',modalidade:'VOUCHER',bandeira:'ALELO',valor_bruto:'30.960000'}).dados;assert.ok(avaliarParVoucher(a,b));
});
