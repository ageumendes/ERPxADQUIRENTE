import assert from 'node:assert/strict';
import test from 'node:test';
import { extrairEstabelecimentoInterdata, parseMatrizMovimento30Dias } from '../src/parsers/interdata.js';

const cabecalho = ['Bandeira', '', 'Prclas', 'Espeie Pag', '', 'Nº Op', '', 'A/D', ' Vlr. Parcela', '', 'Vlr. Liquido', '', 'Emissão', '', 'Vencimento', '', 'Código', 'Cód. Venda', 'Data/Hora', '', '', 'Cód. Clt', 'Cód. Cliente'];
const venda = ['VISA DEBITO', '', '1/1', 'DÉBITO', '', '000002', '', 'R$0,00', '22.19', '', '21.94591', '', '27/08/2026', '', '27/08/2026', '', '830483', '2878181', '27/08/2026 06:45:44', '', '', '1', 'CLIENTE NÃO INFORMADO'];
const rodape = ['COMERCIO VAREJISTA DE ALIMENTOS TIGRE LTDA', '27.752.608/0001-29'];

test('encontra a LOJA/CNPJ no rodapé do relatório de 30 dias', () => {
  const matriz = [cabecalho, venda, ...Array.from({length: 35}, () => []), rodape];
  assert.equal(extrairEstabelecimentoInterdata(matriz).cnpj, '27752608000129');
});

test('hash do movimento é estável entre importações e independe da posição da linha', () => {
  const matriz1 = [cabecalho, venda, rodape];
  const matriz2 = [cabecalho, [], venda, rodape];
  const a = parseMatrizMovimento30Dias('lote-A', matriz1, '2026-09-26T00:00:00Z');
  const b = parseMatrizMovimento30Dias('lote-B', matriz2, '2026-09-27T00:00:00Z');
  assert.equal(a?.length, 1);
  assert.equal(b?.length, 1);
  assert.equal(a?.[0].hash_linha, b?.[0].hash_linha);
  assert.equal(a?.[0].cnpj_estabelecimento, '27752608000129');
  assert.equal(a?.[0].data_venda, '27/08/2026');
  assert.equal(a?.[0].hora_venda, '06:45:44');
});
