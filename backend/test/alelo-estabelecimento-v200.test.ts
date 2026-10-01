import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAleloLayout } from '../src/parsers/alelo-layout.js';
import { enriquecerEstabelecimentoVenda } from '../src/services/estabelecimento.service.js';

function linha(campos: Array<[number, string]>) {
  const chars = Array(500).fill(' ');
  for (const [inicio, valor] of campos) [...valor].forEach((c, i) => { chars[inicio - 1 + i] = c; });
  return chars.join('');
}

test('ALELO identifica cada EC da venda, preserva zeros e mantém hash entre importações', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alelo-ec-'));
  try {
    const ecs = ['000001096033906', '000006000290924'];
    const vendas = ecs.map(ec => linha([[1, '01'], [33, ecs[0]], [48, ec], [63, '27752608'], [71, ' 01'], [111, '20260915'], [134, '0000100000000']]));
    const arquivo = join(dir, 'edi.txt');
    await writeFile(arquivo, [linha([[1, '00'], [3, ecs[0]], [50, 'ALELO'], [55, '01']]), ...vendas, linha([[1, '99'], [3, '00000000002']])].join('\n'));
    const a = await parseAleloLayout('a', arquivo);
    const b = await parseAleloLayout('b', arquivo);
    assert.deepEqual(a.vendas_adquirentes.map(v => v.cnpj_estabelecimento), ecs);
    for (const [i, venda] of a.vendas_adquirentes.entries()) {
      const enriquecida = enriquecerEstabelecimentoVenda(venda);
      assert.equal(enriquecida.codigo_estabelecimento, ecs[i]);
      assert.equal(enriquecida.dados_json?.codigo_estabelecimento_original, ecs[i]);
      assert.equal(enriquecida.dados_json?.codigo_estabelecimento_origem, 'ec_filial');
      assert.equal(venda.dados_json?.matriz_pagamento, ecs[0]);
      assert.equal(venda.dados_json?.raiz_cnpj, '27752608');
      assert.equal(venda.linha_original, vendas[i]);
      assert.equal(venda.hash_linha, b.vendas_adquirentes[i].hash_linha);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
