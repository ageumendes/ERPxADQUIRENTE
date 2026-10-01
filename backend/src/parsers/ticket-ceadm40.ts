import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { RegistroTicketCeAdm40, VendaAdquirente } from '../repositorio.js';

type Campo = [string, number, number];

type ContextoGrupo = {
  caixa_postal: string;
  codigo_produto: string;
  lote: string;
  data_vendas: string;
  data_pagamento: string;
  banco: string;
  agencia: string;
  conta: string;
};

const HEADER: Campo[] = [
  ['tipo_registro',1,1],['data_geracao',2,9],['hora_geracao',10,15],['data_referencia',16,23],
  ['layout',24,30],['caixa_postal',31,46],['cnpj_emissor',47,60],['nome_emissor',61,80],
  ['sequencial_arquivo',81,89],['reservado',90,198],['indicador_final',199,200],
];
const GRUPO: Campo[] = [
  ['tipo_registro',1,1],['caixa_postal',2,16],['codigo_produto',17,18],['reservado_1',19,21],
  ['lote',22,30],['data_vendas',31,38],['data_pagamento',39,46],['banco',47,49],['agencia',50,55],
  ['conta',56,66],['quantidade_transacoes',67,75],['campo_76_82',76,82],['valor_bruto_grupo',83,96],
  ['campo_monetario_97_110',97,110],['taxa_percentual_grupo',111,120],['valor_taxas_grupo',121,132],
  ['reservado_2',133,168],['indicador',169,170],['reservado_3',171,200],
];
const VENDA: Campo[] = [
  ['tipo_registro',1,1],['identificacao_estabelecimento',2,16],['lote',17,25],['nsu',26,37],
  ['data_venda',38,45],['hora_venda',46,51],['cartao_mascarado',52,70],['valor_bruto',71,82],
  ['campo_monetario_83_94',83,94],['valor_taxa',95,106],['parcela_atual',107,108],['quantidade_parcelas',109,110],
  ['valor_referencia',111,122],['data_pagamento',123,130],['identificador_repetido',131,140],
  ['canal_captura',141,143],['codigo_rede_captura',144,148],['rede_captura',149,160],
  ['indicador_operacao',161,161],['reservado',162,200],
];
const FINANCEIRO: Campo[] = [
  ['tipo_registro',1,1],['identificacao',2,16],['lote',17,25],['data_pagamento',26,33],
  ['valor_financeiro',34,48],['natureza',49,49],['descricao',50,84],['codigo_lancamento',85,89],
  ['taxa_percentual',90,99],['reservado',100,200],
];
const TRAILER: Campo[] = [['tipo_registro',1,1],['quantidade_total_linhas',2,10],['reservado',11,200]];

const campo = (linha:string,inicio:number,fim:number) => linha.slice(inicio - 1, fim).trim();
const extrair = (linha:string, campos:Campo[]) => Object.fromEntries(campos.map(([nome,inicio,fim]) => [nome,campo(linha,inicio,fim)]));
const dinheiro = (valor:string) => {
  if (!/^\d+$/.test(valor)) throw new Error(`Valor monetário TICKET inválido: ${valor || '(vazio)'}.`);
  return (Number(valor) / 100).toFixed(2);
};
const percentual = (valor:string) => {
  if (!/^\d+$/.test(valor)) return '';
  return (Number(valor) / 100).toFixed(2);
};
const hash = (linha:string) => crypto.createHash('sha256').update(`TICKET_CEADM40|${linha}`).digest('hex');

function validarData(valor:string, rotulo:string) {
  if (!/^\d{8}$/.test(valor)) throw new Error(`${rotulo} TICKET inválida: ${valor || '(vazia)'}.`);
  const dia=Number(valor.slice(0,2)), mes=Number(valor.slice(2,4)), ano=Number(valor.slice(4,8));
  const data=new Date(Date.UTC(ano,mes-1,dia));
  if (data.getUTCFullYear()!==ano || data.getUTCMonth()!==mes-1 || data.getUTCDate()!==dia) throw new Error(`${rotulo} TICKET inválida: ${valor}.`);
}
function validarHora(valor:string) {
  if (!/^\d{6}$/.test(valor) || Number(valor.slice(0,2))>23 || Number(valor.slice(2,4))>59 || Number(valor.slice(4,6))>59) {
    throw new Error(`Hora TICKET inválida: ${valor || '(vazia)'}.`);
  }
}

function registroBruto(importacaoId:string, numeroLinha:number, linha:string, grupo:'VENDA'|'PAGAMENTO', dados:Record<string,string>):RegistroTicketCeAdm40 {
  return {
    ...dados,
    id:`${importacaoId}-ticket-${grupo.toLowerCase()}-${numeroLinha}`,
    importacao_id:importacaoId,
    tipo_arquivo:'TICKET_CEADM40',
    codigo_registro:dados.tipo_registro,
    grupo_registro:grupo,
    numero_linha:numeroLinha,
    linha_original:linha,
    hash_linha:hash(linha),
    dados_json:dados,
    data_criacao:new Date().toISOString(),
  };
}

function mapearVenda(importacaoId:string, numeroLinha:number, linha:string, dados:Record<string,string>, contexto:ContextoGrupo):VendaAdquirente {
  validarData(dados.data_venda, 'Data da venda');
  validarData(dados.data_pagamento, 'Data de pagamento');
  validarHora(dados.hora_venda);
  const bruto = Number(dinheiro(dados.valor_bruto));
  const taxa = Number(dinheiro(dados.valor_taxa));
  const parcelaAtual = Number(dados.parcela_atual || '1') || 1;
  const quantidadeParcelas = Number(dados.quantidade_parcelas || '1') || 1;
  const codigoProduto = contexto.codigo_produto || 'TA';
  return {
    id:`${importacaoId}-ticket-venda-${numeroLinha}`,
    importacao_id:importacaoId,
    adquirente:'TICKET',
    layout_origem:'ticket_ceadm40',
    tipo_arquivo:'TICKET_CEADM40',
    codigo_registro:'2',
    numero_linha:numeroLinha,
    data_venda:dados.data_venda,
    hora_venda:dados.hora_venda,
    data_pagamento:dados.data_pagamento,
    valor_bruto:bruto.toFixed(2),
    valor_taxa:taxa.toFixed(2),
    valor_liquido:(bruto - taxa).toFixed(2),
    nsu:dados.nsu,
    codigo_autorizacao:'',
    terminal:dados.canal_captura,
    bandeira:'TICKET',
    modalidade:'VOUCHER',
    parcelas:`${parcelaAtual}/${quantidadeParcelas}`,
    status_transacao:'AUTORIZADO',
    codigo_produto:codigoProduto,
    hash_linha:hash(linha),
    linha_original:linha,
    dados_json:{
      ...dados,
      codigo_produto:codigoProduto,
      lote_grupo:contexto.lote,
      data_vendas_grupo:contexto.data_vendas,
      data_pagamento_grupo:contexto.data_pagamento,
      banco_grupo:contexto.banco,
      agencia_grupo:contexto.agencia,
      conta_grupo:contexto.conta,
      rede_captura: dados.rede_captura,
      canal_captura: dados.canal_captura,
    },
    data_criacao:new Date().toISOString(),
  };
}

export async function parseTicketCeAdm40(importacaoId:string, caminhoArquivo:string, nomeOriginal:string) {
  const buffer = await fs.readFile(caminhoArquivo);
  let conteudo:string;
  try { conteudo = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new Error('Arquivo TICKET CEADM40 inválido: conteúdo não está em UTF-8 válido.'); }
  const linhas = conteudo.split(/\r?\n/).map((linha) => linha.replace(/\r$/, '')).filter((linha) => linha.length > 0);
  if (linhas.length < 3) throw new Error('Arquivo TICKET CEADM40 inválido: arquivo incompleto.');
  linhas.forEach((linha,index) => { if (linha.length !== 200) throw new Error(`Arquivo TICKET CEADM40 inválido: linha ${index+1} possui ${linha.length} caracteres; esperado 200.`); });
  if (linhas[0][0] !== '0' || linhas.at(-1)?.[0] !== '9') throw new Error('Arquivo TICKET CEADM40 inválido: header 0 ou trailer 9 ausente.');
  const header = extrair(linhas[0], HEADER);
  if (header.layout !== 'CEADM40') throw new Error(`Layout TICKET inválido: esperado CEADM40, recebido ${header.layout || '(vazio)'}.`);
  if (!header.nome_emissor.toUpperCase().includes('TICKET')) throw new Error(`Emissor TICKET inválido: ${header.nome_emissor || '(vazio)'}.`);
  const trailer = extrair(linhas.at(-1)!, TRAILER);
  const totalInformado = Number(trailer.quantidade_total_linhas);
  if (totalInformado !== linhas.length) throw new Error(`Trailer TICKET informa ${totalInformado} linhas, mas o arquivo possui ${linhas.length}.`);

  const registros_vendas:RegistroTicketCeAdm40[] = [];
  const registros_pagamentos:RegistroTicketCeAdm40[] = [];
  const vendas_adquirentes:VendaAdquirente[] = [];
  let contexto:ContextoGrupo = { caixa_postal:'',codigo_produto:'',lote:'',data_vendas:'',data_pagamento:'',banco:'',agencia:'',conta:'' };

  linhas.forEach((linha,index) => {
    const numeroLinha=index+1, tipo=linha[0];
    if (tipo === '0' || tipo === '9') return;
    if (tipo === '1') {
      const dados = extrair(linha, GRUPO);
      validarData(dados.data_vendas, 'Data do agrupamento');
      validarData(dados.data_pagamento, 'Data de pagamento do agrupamento');
      contexto = {
        caixa_postal:dados.caixa_postal,codigo_produto:dados.codigo_produto,lote:dados.lote,
        data_vendas:dados.data_vendas,data_pagamento:dados.data_pagamento,banco:dados.banco,agencia:dados.agencia,conta:dados.conta,
      };
      return; // subtotalizador: usado só como contexto, nunca persistido
    }
    if (tipo === '2') {
      const dados = extrair(linha, VENDA);
      const raw = registroBruto(importacaoId, numeroLinha, linha, 'VENDA', {...dados, codigo_produto_grupo:contexto.codigo_produto});
      registros_vendas.push(raw);
      vendas_adquirentes.push(mapearVenda(importacaoId, numeroLinha, linha, dados, contexto));
      return;
    }
    if (tipo === '4') {
      const dados = extrair(linha, FINANCEIRO);
      validarData(dados.data_pagamento, 'Data financeira');
      registros_pagamentos.push(registroBruto(importacaoId, numeroLinha, linha, 'PAGAMENTO', {
        ...dados,
        valor_financeiro_decimal:dinheiro(dados.valor_financeiro),
        taxa_percentual_decimal:percentual(dados.taxa_percentual),
      }));
      return;
    }
    throw new Error(`Registro TICKET ${tipo || '?'} desconhecido na linha ${numeroLinha}.`);
  });

  return {
    tipo_arquivo:'TICKET_CEADM40' as const,
    nome_original:nomeOriginal,
    header,
    registros_vendas,
    registros_pagamentos,
    vendas_adquirentes,
    quantidade_linhas:linhas.length,
  };
}
