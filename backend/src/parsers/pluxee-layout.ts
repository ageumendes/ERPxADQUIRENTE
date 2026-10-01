import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { RegistroPluxee, VendaAdquirente } from '../repositorio.js';

type Campo = [string, number, number];
type TipoArquivo = 'CEADM10' | 'CONPGT01';

const HEADER: Campo[] = [
  ['tipo_registro',1,1],['data_criacao_arquivo',2,9],['hora_criacao_arquivo',10,15],['data_referencia',16,23],
  ['arquivo_versao',24,31],['cnpj_estabelecimento_principal',32,46],['cnpj_administradora',47,60],
  ['nome_administradora',61,80],['sequencia_reprocessamento',81,89],['codigo_estabelecimento',90,99],
  ['codigo_loja',100,109],['sequencia_arquivo',110,115],['codigo_administradora',116,117],['reservado',118,200],
];
const RESUMO: Campo[] = [
  ['tipo_registro',1,1],['cnpj',2,16],['produto_codigo',17,18],['forma_captura',19,21],['numero_rv',22,30],
  ['data_original',31,38],['data_pagamento',39,46],['banco',47,49],['agencia',50,55],['conta',56,66],
  ['quantidade_aceita',67,75],['quantidade_rejeitada',76,84],['valor_bruto',85,96],['valor_liquido',97,108],
  ['taxa_servico',109,120],['comissao',121,132],['valor_rejeitado',133,144],['valor_credito',145,156],
  ['valor_encargos',157,168],['indicador_pagamento',169,170],['codigo_estabelecimento',171,180],['codigo_loja',181,190],
  ['campo_final',191,200],
];
const TRANSACAO: Campo[] = [
  ['tipo_registro',1,1],['cnpj',2,16],['numero_rv',17,25],['nsu_adquirente',26,37],['data_transacao',38,45],
  ['hora_transacao',46,51],['cartao_mascarado',52,70],['valor_bruto',71,82],['valor_saque',83,94],
  ['taxa_servico',95,106],['numero_parcelas',107,108],['parcela_paga',109,110],['valor_parcela',111,122],
  ['data_pagamento_prevista',123,130],['autorizacao',131,140],['codigo_estabelecimento',141,150],
  ['codigo_loja',151,160],['terminal',161,168],['nsu_tef',169,174],['rede_captura',175,177],['forma_codigo',178,179],
  ['reservado',180,200],
];
const ENCARGO: Campo[] = [
  ['tipo_registro',1,1],['cnpj',2,16],['numero_rv',17,25],['data_original_pagamento',26,33],
  ['codigo_encargo',34,36],['descricao',37,76],['valor_encargo',77,88],['codigo_estabelecimento',89,98],
  ['codigo_loja',99,108],['origem',109,110],['reservado',111,200],
];
const AJUSTE: Campo[] = [
  ['tipo_registro',1,1],['cnpj',2,16],['numero_rv',17,25],['data_ajuste',26,33],['cartao_mascarado',34,52],
  ['sinal',53,53],['valor_ajuste',54,65],['motivo_ajuste',66,67],['rv_original',68,76],['nsu_original',77,88],
  ['data_transacao_original',89,96],['codigo_estabelecimento',97,106],['codigo_loja',107,116],['forma_codigo',117,118],
  ['reservado',119,200],
];
const TRAILER: Campo[] = [['tipo_registro',1,1],['quantidade_total_registros',2,10],['reservado',11,200]];

const campo = (linha:string,inicio:number,fim:number) => linha.slice(inicio - 1, fim).trim();
const extrair = (linha:string, campos:Campo[]) => Object.fromEntries(campos.map(([nome,inicio,fim]) => [nome,campo(linha,inicio,fim)]));
const centavos = (valor:string) => {
  if (!/^\d+$/.test(valor)) throw new Error(`Valor monetário PLUXEE inválido: ${valor || '(vazio)'}.`);
  return Number(valor) / 100;
};
const dataIso = (valor:string) => {
  if (!/^\d{8}$/.test(valor)) throw new Error(`Data PLUXEE inválida: ${valor || '(vazia)'}.`);
  const dia=Number(valor.slice(0,2)),mes=Number(valor.slice(2,4)),ano=Number(valor.slice(4,8));
  const data=new Date(Date.UTC(ano,mes-1,dia));
  if(data.getUTCFullYear()!==ano||data.getUTCMonth()!==mes-1||data.getUTCDate()!==dia) throw new Error(`Data PLUXEE inválida: ${valor}.`);
  return `${valor.slice(4,8)}-${valor.slice(2,4)}-${valor.slice(0,2)}`;
};
const horaIso = (valor:string) => {
  if (!/^\d{6}$/.test(valor) || Number(valor.slice(0,2))>23 || Number(valor.slice(2,4))>59 || Number(valor.slice(4,6))>59) throw new Error(`Hora PLUXEE inválida: ${valor || '(vazia)'}.`);
  return `${valor.slice(0,2)}:${valor.slice(2,4)}:${valor.slice(4,6)}`;
};
const hash = (tipo:TipoArquivo, linha:string) => crypto.createHash('sha256').update(`${tipo}|${linha}`).digest('hex');

function camposRegistro(tipoArquivo:TipoArquivo, codigo:string):Campo[] {
  if(codigo==='0') return HEADER;
  if(codigo==='1') return RESUMO;
  if(codigo==='9') return TRAILER;
  if(tipoArquivo==='CEADM10' && codigo==='2') return TRANSACAO;
  if(tipoArquivo==='CONPGT01' && codigo==='2') return ENCARGO;
  if(tipoArquivo==='CONPGT01' && codigo==='3') return AJUSTE;
  if(tipoArquivo==='CONPGT01' && codigo==='4') return TRANSACAO;
  throw new Error(`Registro ${codigo || '?'} incompatível com o arquivo PLUXEE ${tipoArquivo}.`);
}

function mapearVenda(importacaoId:string, numeroLinha:number, linha:string, dados:Record<string,string>, hashLinha:string):VendaAdquirente {
  const bruto=centavos(dados.valor_bruto), taxa=centavos(dados.taxa_servico), liquido=bruto-taxa;
  const nsuAdquirente=dados.nsu_adquirente;
  const nsuTef=dados.nsu_tef;
  const nsu=nsuTef && nsuTef!=='000000' && nsuTef!==nsuAdquirente.slice(-6) ? nsuTef : nsuAdquirente;
  return {
    id:`${importacaoId}-pluxee-venda-${numeroLinha}`, importacao_id:importacaoId, adquirente:'PLUXEE',
    layout_origem:'pluxee_ceadm10', tipo_arquivo:'CEADM10', codigo_registro:'2', numero_linha:numeroLinha,
    data_venda:dataIso(dados.data_transacao), hora_venda:horaIso(dados.hora_transacao), data_pagamento:dataIso(dados.data_pagamento_prevista),
    valor_bruto:bruto.toFixed(2), valor_taxa:taxa.toFixed(2), valor_liquido:liquido.toFixed(2), nsu,
    codigo_autorizacao:dados.autorizacao, terminal:dados.terminal, cnpj_estabelecimento:dados.cnpj,
    bandeira:'PLUXEE', modalidade:'VOUCHER', parcelas:`${dados.parcela_paga || '01'}/${dados.numero_parcelas || '01'}`,
    status_transacao:'AUTORIZADO', codigo_produto:dados.forma_codigo, hash_linha:hashLinha, linha_original:linha,
    dados_json:{...dados,nsu_adquirente:nsuAdquirente,nsu_tef:nsuTef,produto_modalidade_pendente:'SIM'}, data_criacao:new Date().toISOString(),
  };
}

export async function parsePluxeeLayout(importacaoId:string, caminhoArquivo:string) {
  const buffer=await fs.readFile(caminhoArquivo); const utf8=buffer.toString('utf8'); const texto=utf8.includes('�')?buffer.toString('latin1'):utf8;
  const linhas=texto.split(/\r?\n/).map((linha)=>linha.replace(/\r$/,'')).filter(Boolean);
  if(linhas.length<2 || linhas[0][0]!=='0' || linhas.at(-1)?.[0]!=='9') throw new Error('Arquivo PLUXEE inválido: header 0 ou trailer 9 ausente.');
  linhas.forEach((linha,index)=>{if(linha.length!==200) throw new Error(`Arquivo PLUXEE inválido: linha ${index+1} possui ${linha.length} posições; esperado 200.`);});
  const identificadorArquivo=campo(linhas[0],24,31).toUpperCase();
  const tipoArquivo:TipoArquivo=identificadorArquivo==='CEADM100'?'CEADM10':identificadorArquivo as TipoArquivo;
  if(!['CEADM10','CONPGT01'].includes(tipoArquivo)) throw new Error(`Identificador PLUXEE desconhecido: ${identificadorArquivo || '(vazio)'}.`);
  const registros_brutos:RegistroPluxee[]=[]; const vendas_adquirentes:VendaAdquirente[]=[]; const rvs=new Set<string>();
  const brutoResumoPorRv=new Map<string,number>(); const brutoDetalhesPorRv=new Map<string,number>();
  const resumoPorRv=new Map<string,Record<string,string>>(); const vendasPorRv=new Map<string,VendaAdquirente[]>();
  linhas.forEach((linha,index)=>{
    const numeroLinha=index+1,codigo=linha[0],dados=extrair(linha,camposRegistro(tipoArquivo,codigo)),hashLinha=hash(tipoArquivo,linha);
    if(codigo==='0'){dataIso(dados.data_criacao_arquivo);dataIso(dados.data_referencia);horaIso(dados.hora_criacao_arquivo);}
    if(codigo==='1'){
      dataIso(dados.data_original);dataIso(dados.data_pagamento);
      ['valor_bruto','valor_liquido','taxa_servico','comissao','valor_rejeitado','valor_credito','valor_encargos'].forEach((nome)=>centavos(dados[nome]));
    }
    if((tipoArquivo==='CEADM10'&&codigo==='2')||(tipoArquivo==='CONPGT01'&&codigo==='4')){
      dataIso(dados.data_transacao);dataIso(dados.data_pagamento_prevista);horaIso(dados.hora_transacao);
      ['valor_bruto','valor_saque','taxa_servico','valor_parcela'].forEach((nome)=>centavos(dados[nome]));
    }
    if(tipoArquivo==='CONPGT01'&&codigo==='2'){dataIso(dados.data_original_pagamento);centavos(dados.valor_encargo);}
    if(tipoArquivo==='CONPGT01'&&codigo==='3'){dataIso(dados.data_ajuste);dataIso(dados.data_transacao_original);centavos(dados.valor_ajuste);}
    if(codigo==='1') { rvs.add(dados.numero_rv); brutoResumoPorRv.set(dados.numero_rv,centavos(dados.valor_bruto)); resumoPorRv.set(dados.numero_rv,dados); }
    if(['2','3','4'].includes(codigo) && dados.numero_rv && !rvs.has(dados.numero_rv)) throw new Error(`Detalhe PLUXEE sem RV pai na linha ${numeroLinha}: ${dados.numero_rv}.`);
    const registroNegocio = tipoArquivo==='CEADM10' ? codigo==='2' : ['2','3','4'].includes(codigo);
    if(registroNegocio) registros_brutos.push({id:`${importacaoId}-pluxee-raw-${numeroLinha}`,importacao_id:importacaoId,tipo_arquivo:tipoArquivo,codigo_registro:codigo,numero_linha:numeroLinha,linha_original:linha,hash_linha:hashLinha,dados_json:dados,data_criacao:new Date().toISOString()});
    if((tipoArquivo==='CEADM10'&&codigo==='2')||(tipoArquivo==='CONPGT01'&&codigo==='4')) brutoDetalhesPorRv.set(dados.numero_rv,(brutoDetalhesPorRv.get(dados.numero_rv)||0)+centavos(dados.valor_bruto));
    if(tipoArquivo==='CEADM10' && codigo==='2') {
      const venda=mapearVenda(importacaoId,numeroLinha,linha,dados,hashLinha); vendas_adquirentes.push(venda);
      const vendasRv=vendasPorRv.get(dados.numero_rv)||[]; vendasRv.push(venda); vendasPorRv.set(dados.numero_rv,vendasRv);
    }
  });
  const total=Number(extrair(linhas.at(-1)!,TRAILER).quantidade_total_registros||0);
  if(total!==linhas.length) throw new Error(`Arquivo PLUXEE inválido: trailer informa ${total} registros, mas o arquivo contém ${linhas.length}.`);
  for(const [rv,brutoResumo] of brutoResumoPorRv){
    const brutoDetalhes=brutoDetalhesPorRv.get(rv)||0;
    if(Math.abs(brutoResumo-brutoDetalhes)>0.001) throw new Error(`Arquivo PLUXEE inválido: RV ${rv} informa bruto ${brutoResumo.toFixed(2)}, mas os detalhes somam ${brutoDetalhes.toFixed(2)}.`);
  }
  // O SDX real concentra comissão/taxa no resumo do RV e costuma enviar taxa
  // zero nas transações. Rateamos o desconto financeiro do RV em centavos,
  // proporcionalmente ao bruto, atribuindo o resíduo à última venda para que
  // bruto - taxa = líquido feche exatamente com o resumo da PLUXEE.
  if(tipoArquivo==='CEADM10') for(const [rv,vendasRv] of vendasPorRv){
    const resumo=resumoPorRv.get(rv); if(!resumo||vendasRv.length===0) continue;
    const brutoResumoCent=Math.round(centavos(resumo.valor_bruto)*100);
    const liquidoResumoCent=Math.round(centavos(resumo.valor_liquido)*100);
    const rejeitadoCent=Math.round(centavos(resumo.valor_rejeitado)*100);
    const taxaTotalCent=Math.max(0,brutoResumoCent-liquidoResumoCent-rejeitadoCent);
    const brutoVendasCent=vendasRv.reduce((soma,venda)=>soma+Math.round(Number(venda.valor_bruto||0)*100),0);
    let taxaDistribuida=0;
    vendasRv.forEach((venda,index)=>{
      const brutoCent=Math.round(Number(venda.valor_bruto||0)*100);
      const taxaCent=index===vendasRv.length-1?taxaTotalCent-taxaDistribuida:Math.round(taxaTotalCent*brutoCent/Math.max(1,brutoVendasCent));
      taxaDistribuida+=taxaCent; venda.valor_taxa=(taxaCent/100).toFixed(2); venda.valor_liquido=((brutoCent-taxaCent)/100).toFixed(2);
      venda.dados_json={...venda.dados_json,numero_rv:rv,taxa_rateada_resumo_rv:'SIM',taxa_total_rv:(taxaTotalCent/100).toFixed(2)};
    });
  }
  return {tipo_arquivo:tipoArquivo,registros_brutos,vendas_adquirentes};
}
