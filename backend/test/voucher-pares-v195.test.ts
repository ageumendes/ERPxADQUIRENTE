import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir } from 'node:fs/promises';
import { parseVrLayout16ap } from '../src/parsers/vr-layout-16ap.js';
import { resolve } from 'node:path';
import { selecionarParesVoucher, avaliarParVoucher } from '../src/services/voucher-pares.js';
import type { VendaAdquirente } from '../src/repositories/repositorio.js';
import { parseSipagExtratoCsv } from '../src/parsers/sipag-extratos-csv.js';
import { parsePluxeeLayout } from '../src/parsers/pluxee-layout.js';
import { parseTicketCeAdm40 } from '../src/parsers/ticket-ceadm40.js';
const v=(id:string,adquirente:string, extra:Partial<VendaAdquirente>={}):VendaAdquirente=>({
  id,adquirente,importacao_id:id,layout_origem:'teste',tipo_arquivo:'TESTE',codigo_registro:'VENDA',numero_linha:1,
  data_venda:'2026-09-04',hora_venda:'12:10:20',valor_bruto:'100.00',valor_taxa:'0.00',valor_liquido:'100.00',
  codigo_estabelecimento:'LOJA-A',codigo_autorizacao:'012345',modalidade:'VOUCHER',bandeira:'',status_transacao:'AUTORIZADO',parcelas:'1/1',
  hash_linha:id,linha_original:id,dados_json:{},data_criacao:'2026-09-09',...extra,
});
const c=v('c','SIPAG'),e=v('e','PLUXEE',{codigo_autorizacao:'0000012345',hora_venda:'12:10:01',valor_taxa:'6.90',valor_liquido:'93.10'});

test('três redes de captura × cinco adquirentes: autorização normalizada e bandeira vazia',()=>{
  for(const captura of ['SIPAG','SICREDI','CIELO']) for(const rede of ['ALELO','PLUXEE','TICKET','VR','COOPCERTO']) {
    const resultado=selecionarParesVoucher([{...c,adquirente:captura}],[{...e,adquirente:rede}]);
    assert.equal(resultado[0].status,'VINCULADO',`${captura}/${rede}`);
    assert.equal(resultado[0].economica?.valor_taxa,'6.90');
  }
});
test('zeros à esquerda, NSU ausente e diferença de 60s',()=>{
 assert.ok(avaliarParVoucher(c,{...e,hora_venda:'12:09:20'}));
 assert.equal(avaliarParVoucher(c,{...e,hora_venda:'12:09:19'}),null);
});
test('não une lojas, valores, datas, parcelas e autorizações diferentes',()=>{
 for(const x of [{codigo_estabelecimento:'LOJA-B'},{valor_bruto:'100.01'},{data_venda:'2026-09-05'},{parcelas:'2/2'},{codigo_autorizacao:'54321'}]) assert.equal(avaliarParVoucher(c,{...e,...x}),null);
 assert.equal(avaliarParVoucher({...c,cnpj_estabelecimento:'27752608000129'},{...e,cnpj_estabelecimento:'27752608000200'}),null);
});
test('não une negativos/pendentes nem modalidades não voucher',()=>{
 for(const status of ['NEGADO','PENDENTE','CANCELADO','ESTORNADO','DEVOLVIDO','UNAUTHORIZED']) {
  assert.equal(avaliarParVoucher({...c,status_transacao:status},e),null);
  assert.equal(avaliarParVoucher(c,{...e,status_transacao:status}),null);
 }
 assert.equal(avaliarParVoucher({...c,modalidade:'CREDITO'},e),null);
});
test('valor/data/hora sozinhos não bastam; ausência de loja não permite vínculo',()=>{
 const a={...c,codigo_autorizacao:'000000',nsu:'000000'};
 assert.equal(avaliarParVoucher(a,{...e,codigo_autorizacao:'',nsu:''}),null);
 assert.equal(avaliarParVoucher({...c,codigo_estabelecimento:''},{...e,codigo_estabelecimento:''}),null);
});
test('ambiguidade em ambas as direções inclusive NSU e em redes distintas',()=>{
 assert.equal(selecionarParesVoucher([c],[e,{...e,id:'e2',adquirente:'VR'}])[0].status,'AMBIGUO');
 const cs=[c,{...c,id:'c2',adquirente:'CIELO'}];
 assert.deepEqual(selecionarParesVoucher(cs,[e]).map(x=>x.status),['AMBIGUO','AMBIGUO']);
 const nsus=cs.map(x=>({...x,codigo_autorizacao:'',nsu:'000888'}));
 assert.deepEqual(selecionarParesVoucher(nsus,[{...e,codigo_autorizacao:'',nsu:'888'}]).map(x=>x.status),['AMBIGUO','AMBIGUO']);
});
test('execução repetida reserva o destino e não absorve segunda captura',()=>{
 const linked={...c,status_vinculo_voucher:'VINCULADO' as const,vinculo_voucher_id:e.id,suprimido_por_vinculo_voucher:true};
 assert.deepEqual(selecionarParesVoucher([linked,{...c,id:'c2'}],[e]).map(x=>x.status),['JA_VINCULADO','AMBIGUO']);
 assert.equal(selecionarParesVoucher([c],[{...e,status_vinculo_voucher:'VINCULADO'}])[0].status,'AMBIGUO');
});
test('independe da ordem dos arquivos; ausência do par mantém captura',()=>{
 assert.equal(selecionarParesVoucher([c],[])[0].status,'SEM_VINCULO');
 assert.deepEqual(selecionarParesVoucher([],[e]),[]);
 assert.equal(selecionarParesVoucher([c],[e])[0].status,'VINCULADO');
});
test('documento mascarado exige identificador forte e horário',()=>{
 const a={...c,codigo_estabelecimento:'106145980001',dados_json:{Documento:'27.***.***/0001-29'}};
 const b={...e,codigo_estabelecimento:'2389057',cnpj_estabelecimento:'027752608000129'};
 assert.equal(avaliarParVoucher(a,b)?.loja,'MASCARA');
 assert.equal(avaliarParVoucher({...a,hora_venda:''},b),null);
 assert.equal(avaliarParVoucher({...a,codigo_autorizacao:''},{...b,codigo_autorizacao:''}),null);
});
test('extrato SIPAG aprovado não cria capturas canônicas nem vínculos voucher',async()=>{
 const dir=resolve(process.cwd().endsWith('backend') ? process.cwd() : resolve(process.cwd(),'backend'),'test/fixtures/voucher')+'/';
 const sipag=await parseSipagExtratoCsv('s',dir+'relatorio_transacoes_autorizadas.csv','relatorio_transacoes_autorizadas.csv');
 const p1=await parsePluxeeLayout('p1',dir+'SDX260905.2389057.026');
 const p2=await parsePluxeeLayout('p2',dir+'SDX260906.2389057.026');
 const ticket=await parseTicketCeAdm40('t',dir+'DET02092026-140434542.TXT','DET02092026-140434542.TXT');
 const vr=(await Promise.all((await readdir(dir)).filter(n=>n.startsWith('VR_')).map(n=>parseVrLayout16ap(n,dir+n)))).flatMap(r=>r.vendas_adquirentes);
 const result=selecionarParesVoucher(sipag.vendas_adquirentes,[...p1.vendas_adquirentes,...p2.vendas_adquirentes,...ticket.vendas_adquirentes,...vr]);
 assert.ok(sipag.registros_brutos.length > 0);
 assert.equal(sipag.vendas_adquirentes.length,0);
 assert.deepEqual(result,[]);
});
test('duas conciliações ERP existentes impedem união automática',()=>{
 assert.equal(selecionarParesVoucher([{...c,conciliacao_id:'ERP-A'}],[{...e,conciliacao_id:'ERP-B'}])[0].status,'AMBIGUO');
 assert.equal(selecionarParesVoucher([{...c,conciliacao_id:'ERP-A'}],[e])[0].status,'VINCULADO');
});
test('cartões mascarados com últimos dígitos diferentes não são declarados iguais',()=>{
 const r=avaliarParVoucher({...c,dados_json:{'Nº cartão':'603389******1029'}},{...e,dados_json:{cartao_mascarado:'603389****362505'}});
 assert.equal(r?.criterio,'AUTORIZACAO_DATA_VALOR');
 assert.equal(r?.cartao_compativel,false);
});
test('situação desconhecida não é promovida a autorizada por coincidência',()=>{
 assert.equal(avaliarParVoucher({...c,status_transacao:'',status_transacao_original:''},e),null);
 assert.equal(avaliarParVoucher(c,{...e,status_transacao:'DESCONHECIDO'}),null);
});
