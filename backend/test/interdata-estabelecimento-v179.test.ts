import assert from 'node:assert/strict';
import test from 'node:test';
import { extrairEstabelecimentoInterdata, parseMatrizPosicionalInterdata } from '../src/parsers/interdata.js';

const cabecalhoNovo = [
  'COMERCIO VAREJISTA DE ALIMENTOS TIGRE LTDA', 'Data e Hora da Venda', 'Nº Venda', '', 'NatCart',
  'Data Venda', '27.752.608/0001-29', '', 'Bandeira', '', '', 'Espeie Pag', '', 'Nº Op', '',
  'Status', 'Nº Parcelas', '', 'Status Consiliação', '', '', 'Acrec/Desc', '', '', 'Valor',
];

function venda(numero: number): string[] {
  return ['30/08/2026 06:43', '', String(numero), '', 'E', '30/08/2026', '', '', 'VISA', '', '',
    'DÉBITO', '', '500001', '', 'ATIVO', '1/1', '', 'NÃO', '', '', 'R$0,00', '', '', '6.96'];
}

test('extrai e normaliza o CNPJ e a razão social do cabeçalho INTERDATA', () => {
  assert.deepEqual(extrairEstabelecimentoInterdata([cabecalhoNovo, venda(1)]), {
    cnpj: '27752608000129',
    razao_social: 'COMERCIO VAREJISTA DE ALIMENTOS TIGRE LTDA',
  });
  assert.deepEqual(extrairEstabelecimentoInterdata([['EMPRESA', '', '11.111.111/1111-11']]), { cnpj: '', razao_social: '' });
});

test('propaga o CNPJ do estabelecimento para todas as vendas do novo XLS', () => {
  const resultado = parseMatrizPosicionalInterdata('importacao-v179', [
    cabecalhoNovo, venda(2880915), venda(2880917), venda(2880918), venda(2880919), venda(2880920),
  ]);
  assert.equal(resultado?.length, 5);
  assert.ok(resultado?.every((item) => item.cnpj_estabelecimento === '27752608000129'));
  assert.ok(resultado?.every((item) => item.dados_originais.RAZAO_SOCIAL_ESTABELECIMENTO === 'COMERCIO VAREJISTA DE ALIMENTOS TIGRE LTDA'));
});
