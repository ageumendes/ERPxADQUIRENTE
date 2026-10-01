import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { parsePluxeeLayout } from '../src/parsers/pluxee-layout.js';
import { classificarArquivo } from '../src/services/classifier.service.js';

function linha(campos:Array<[number,number,string]>) {
  const chars=Array(200).fill(' ');
  for(const [inicio,fim,valor] of campos){
    const largura=fim-inicio+1; assert.equal(valor.length,largura,`campo ${inicio}-${fim}`);
    for(let i=0;i<largura;i+=1) chars[inicio-1+i]=valor[i];
  }
  return chars.join('');
}

const header=(tipo:'CEADM10'|'CONPGT01')=>linha([[1,1,'0'],[2,9,'05082026'],[10,15,'031844'],[16,23,'04082026'],[24,31,tipo.padEnd(8,' ')],[32,46,'027752608000129'],[47,60,'69034668000156']]);
const resumo=(tipoPagamento:string)=>linha([[1,1,'1'],[2,16,'027752608000129'],[17,18,'02'],[22,30,'000000001'],[31,38,'04082026'],[39,46,'04092026'],[67,75,'000000001'],[76,84,'000000000'],[85,96,'000000000799'],[97,108,'000000000744'],[109,120,'000000000055'],[121,132,'000000000000'],[133,144,'000000000000'],[145,156,'000000000000'],[157,168,'000000000055'],[169,170,tipoPagamento]]);
const transacao=(codigo:string)=>linha([[1,1,codigo],[2,16,'027752608000129'],[17,25,'000000001'],[26,37,'000000070270'],[38,45,'04082026'],[46,51,'191323'],[52,70,'603389****975329   '],[71,82,'000000000799'],[83,94,'000000000000'],[95,106,'000000000055'],[107,108,'01'],[109,110,'01'],[111,122,'000000000799'],[123,130,'04092026'],[131,140,'0000702701'],[141,150,'0002389057'],[151,160,'          '],[161,168,'00000000'],[169,174,'702701'],[175,177,'022'],[178,179,'06']]);
const trailer=(total:number)=>linha([[1,1,'9'],[2,10,String(total).padStart(9,'0')]]);

test('aceita a variante real CEADM100 como layout de vendas CEADM10',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'pluxee-')); const arquivo=path.join(dir,'SDX260726.2389057.026');
  try{
    const cabecalho=linha([[1,1,'0'],[2,9,'27072026'],[10,15,'012230'],[16,23,'24072026'],[24,31,'CEADM100'],[32,46,'027752608000129'],[47,60,'69034668000156']]);
    await writeFile(arquivo,[cabecalho,resumo('PG'),transacao('2'),trailer(4)].join('\r\n'));
    const classificacao=await classificarArquivo(arquivo,path.basename(arquivo));
    assert.equal(classificacao.layout_detectado,'PLUXEE_CEADM10');
    const resultado=await parsePluxeeLayout('teste-pluxee-real',arquivo);
    assert.equal(resultado.tipo_arquivo,'CEADM10'); assert.equal(resultado.vendas_adquirentes.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('classifica CEADM10 e cria somente a venda SDX',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'pluxee-'));
  const arquivo=path.join(dir,'SDX260805.2389057.026');
  try{
    await writeFile(arquivo,[header('CEADM10'),resumo('PG'),transacao('2'),trailer(4)].join('\r\n'));
    const classificacao=await classificarArquivo(arquivo,path.basename(arquivo));
    assert.equal(classificacao.layout_detectado,'PLUXEE_CEADM10');
    const resultado=await parsePluxeeLayout('teste-pluxee',arquivo);
    assert.equal(resultado.registros_brutos.length,1);
    assert.equal(resultado.registros_brutos[0]?.codigo_registro,'2');
    assert.equal(resultado.vendas_adquirentes.length,1);
    assert.deepEqual({...resultado.vendas_adquirentes[0],dados_json:undefined,linha_original:undefined,data_criacao:undefined,id:undefined,hash_linha:undefined},{
      importacao_id:'teste-pluxee',adquirente:'PLUXEE',layout_origem:'pluxee_ceadm10',tipo_arquivo:'CEADM10',codigo_registro:'2',numero_linha:3,
      data_venda:'2026-08-04',hora_venda:'19:13:23',data_pagamento:'2026-09-04',valor_bruto:'7.99',valor_taxa:'0.55',valor_liquido:'7.44',nsu:'702701',
      codigo_autorizacao:'0000702701',terminal:'00000000',cnpj_estabelecimento:'027752608000129',bandeira:'PLUXEE',modalidade:'VOUCHER',parcelas:'01/01',
      status_transacao:'AUTORIZADO',codigo_produto:'06',dados_json:undefined,linha_original:undefined,data_criacao:undefined,id:undefined,hash_linha:undefined,
    });
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('CONPGT01 preserva liquidação sem duplicar venda',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'pluxee-')); const arquivo=path.join(dir,'SDXP260805.2389057.026');
  try{await writeFile(arquivo,[header('CONPGT01'),resumo('PN'),transacao('4'),trailer(4)].join('\n'));const resultado=await parsePluxeeLayout('teste-pagamento',arquivo);assert.equal(resultado.tipo_arquivo,'CONPGT01');assert.equal(resultado.vendas_adquirentes.length,0);}finally{await rm(dir,{recursive:true,force:true});}
});
