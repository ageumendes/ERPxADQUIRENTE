import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { codigoEstabelecimentoSicoobPeloNome, parseSicoobPspPixJson } from '../src/parsers/sicoob-psp-pix-json.js';
import { classificarArquivo } from '../src/services/classifier.service.js';
import { mapPixParaTabelaSicoob, normalizeSicoobPix } from '../src/services/sicoob/pix-normalizer.js';

const e2e = 'E1234567820260715123456789012345';

test('classifica arquivo diario Sicoob e preserva o endToEndId', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'erpx-sicoob-'));
  const arquivo = path.join(dir, 'sicoob-pix-2026-07-15.json');
  await writeFile(arquivo, JSON.stringify({ origem: 'SICOOB', pix: [{ endToEndId: e2e, txid: 'TX-1', valor: '10.50', horario: '2026-07-15T12:34:56Z' }] }));
  const classificacao = await classificarArquivo(arquivo, path.basename(arquivo));
  assert.equal(classificacao.layout_detectado, 'SICOOB_LAYOUT_PSP_PIX_JSON');
  const parsed = await parseSicoobPspPixJson('IMP-1', arquivo);
  assert.equal(parsed.vendas_adquirentes[0].nsu, e2e);
  assert.equal(parsed.vendas_adquirentes[0].valor_bruto, '10.50');
  assert.equal(parsed.vendas_adquirentes[0].codigo_estabelecimento, '27752608000129');
});

test('SICOOB usa o CNPJ do nome do arquivo como código do estabelecimento', async () => {
  assert.equal(codigoEstabelecimentoSicoobPeloNome('sicoob_pix_2026-08-29.json'), '27752608000129');
  assert.equal(codigoEstabelecimentoSicoobPeloNome('sicoob_pix_27752608000200_2026-08-29.json'), '27752608000200');
  assert.equal(codigoEstabelecimentoSicoobPeloNome('sicoob_pix_27752608000129_2026-08-29.json'), '27752608000129');
  assert.equal(codigoEstabelecimentoSicoobPeloNome('sicoob_pix_27752608000200_reconsulta_2026-08-25_a_2026-09-23.json'), '27752608000200');
  assert.equal(codigoEstabelecimentoSicoobPeloNome('arquivo.json'), '');

  const dir = await mkdtemp(path.join(tmpdir(), 'erpx-sicoob-cnpj-'));
  const arquivo = path.join(dir, 'temporario.json');
  await writeFile(arquivo, JSON.stringify({ pix: [{ endToEndId: e2e, valor: '10.50', horario: '2026-08-29T12:34:56Z' }] }));
  const parsed = await parseSicoobPspPixJson('IMP-CNPJ', arquivo, 'sicoob_pix_27752608000200_2026-08-29.json');
  assert.equal(parsed.vendas_adquirentes[0].codigo_estabelecimento, '27752608000200');
  assert.equal(parsed.vendas_adquirentes[0].cnpj_estabelecimento, '27752608000200');
  assert.equal((parsed.vendas_adquirentes[0].dados_json as any).codigo_estabelecimento_origem, 'NOME_ARQUIVO_SICOOB');
});

test('aceita novo cabeçalho SICOOB e converte a virada UTC para America/La_Paz sem alterar o original', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'erpx-sicoob-lapaz-'));
  const arquivo = path.join(dir, 'sicoob_pix_27752608000129_2026-09-23.json');
  const horario = '2026-09-24T00:01:00Z';
  await writeFile(arquivo, JSON.stringify({
    geradoEm: '2026-09-24T02:00:00Z', ambiente: 'producao', tipoColeta: 'diaria',
    beneficiario: { perfil: 'matriz', codigoEstabelecimento: '27752608000129', cnpj: '27752608000129' },
    consulta: { inicio: '2026-09-23', fim: '2026-09-23' }, resumo: { totalPix: 1 }, raw: { consultas: [] },
    pix: [{ endToEndId: e2e, valor: '10.50', horario, pagador: { nome: 'PAGADOR' }, devolucoes: [] }],
  }));
  const classificacao = await classificarArquivo(arquivo, path.basename(arquivo));
  assert.equal(classificacao.layout_detectado, 'SICOOB_LAYOUT_PSP_PIX_JSON');
  const resultado = await parseSicoobPspPixJson('IMP-LAPAZ', arquivo);
  for (const registro of [resultado.registros_brutos[0], resultado.vendas_adquirentes[0]]) {
    assert.equal(registro.data_venda, '2026-09-23');
    assert.equal(registro.hora_venda, '20:01:00');
  }
  assert.equal(resultado.registros_brutos[0].horario, horario);
  assert.equal((resultado.vendas_adquirentes[0].dados_json as any).horario, horario);
  assert.equal(resultado.vendas_adquirentes[0].codigo_estabelecimento, '27752608000129');
});

test('reconsulta usa identidade deterministica e registra devolucao', () => {
  const original = mapPixParaTabelaSicoob(normalizeSicoobPix({ endToEndId: e2e, valor: '25,90', horario: '2026-07-01T08:00:00Z' }));
  const reconsulta = mapPixParaTabelaSicoob(normalizeSicoobPix({ endToEndId: e2e, valor: '25.90', horario: '2026-07-01T08:00:00Z', devolucoes: [{ id: 'DEV-1', valor: '25.90' }] }));
  assert.equal(reconsulta.id, original.id);
  assert.equal(reconsulta.hash_linha, original.hash_linha);
  assert.equal(reconsulta.tem_devolucao, true);
  assert.equal(reconsulta.quantidade_devolucoes, 1);
});

test('rejeita JSON malformado e payload sem transacoes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'erpx-invalid-'));
  const malformado = path.join(dir, 'invalido.json');
  await writeFile(malformado, '{');
  await assert.rejects(() => parseSicoobPspPixJson('IMP-2', malformado), /JSON malformado/);
  const vazio = path.join(dir, 'vazio.json');
  await writeFile(vazio, JSON.stringify({ pix: [] }));
  await assert.rejects(() => parseSicoobPspPixJson('IMP-3', vazio), /não possui array pix/);
});

test('marca PIX de mesma titularidade como nao util sem alterar o payload bruto', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'erpx-sicoob-own-'));
  const arquivo = path.join(dir, 'sicoob-pix-2026-08-23.json');
  const payload = {
    origem: 'SICOOB',
    pix: [{
      endToEndId: 'E9999999920260823123456789012345',
      txid: 'OWN-1',
      valor: '125.7',
      horario: '2026-08-23T12:34:56.789Z',
      nomePagador: 'MESMA TITULARIDADE',
      pagador: { cnpj: '27.752.608/0001-29', nome: 'MESMA TITULARIDADE' },
      devolucoes: [],
    }],
  };
  await writeFile(arquivo, JSON.stringify(payload));
  const parsed = await parseSicoobPspPixJson('IMP-OWN', arquivo);
  const bruto = parsed.registros_brutos[0] as any;
  const canonico = parsed.vendas_adquirentes[0] as any;
  assert.equal(bruto.dados_json.valor, '125.7');
  assert.equal(bruto.valor, '125.7');
  assert.equal(bruto.utilidade_status, 'NAO_UTIL');
  assert.equal(canonico.utilidade_status, 'NAO_UTIL');
  assert.equal(canonico.utilidade_motivo, 'PIX_MESMA_TITULARIDADE');
  assert.equal(canonico.pagador_documento, '27752608000129');
});
