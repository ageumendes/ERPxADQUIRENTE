import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseVrLayout16ap } from '../src/parsers/vr-layout-16ap.js';
import { classificarArquivo } from '../src/services/classifier.service.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const upload = path.resolve(aqui, '../../../upload');
const nomes = [
  'VR_COMERCIALTIGRE_27752608000129_20260715_000001.txt',
  'VR_COMERCIALTIGRE_27752608000129_20260716_000002.txt',
  'VR_COMERCIALTIGRE_27752608000129_20260717_000003.txt',
  'VR_COMERCIALTIGRE_27752608000129_20260718_000004.txt',
  'VR_COMERCIALTIGRE_27752608000129_20260718_000006.txt',
  'VR_COMERCIALTIGRE_27752608000129_20260719_000005.txt',
];

test('classifica e interpreta os seis arquivos reais VR 16AP', async (contexto) => {
  try {
    await Promise.all(nomes.map((nome) => access(path.join(upload, nome))));
  } catch {
    contexto.skip('Fixtures VR reais não estão incluídas no pacote distribuído.');
    return;
  }
  let vendas = 0; let ajustes = 0; let bruto = 0; let taxa = 0; let liquido = 0;
  for (const [indice, nome] of nomes.entries()) {
    const arquivo = path.join(upload, nome);
    const classificacao = await classificarArquivo(arquivo, nome);
    assert.equal(classificacao.layout_detectado, 'VR_LAYOUT_16AP');
    const resultado = await parseVrLayout16ap(`vr-test-${indice}`, arquivo);
    vendas += resultado.vendas_adquirentes.filter(item => item.codigo_registro === 'V').length;
    ajustes += resultado.registros_brutos.filter(item => item.codigo_registro === 'A').length;
    for (const item of resultado.vendas_adquirentes.filter(item => item.codigo_registro === 'V')) {
      bruto += Number(item.valor_bruto); taxa += Number(item.valor_taxa); liquido += Number(item.valor_liquido);
    }
  }
  assert.equal(vendas, 43); assert.equal(ajustes, 1);
  assert.equal(bruto.toFixed(2), '3069.38'); assert.equal(taxa.toFixed(2), '142.48'); assert.equal(liquido.toFixed(2), '2926.90');
});
