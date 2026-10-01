import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSipagVendasPixCsv } from '../src/parsers/sipag-vendas-pix-csv.js';

test('SIPAG Vendas PIX CSV preserva bruto e trata hífen como taxa zero', async () => {
  const arquivo = path.join(os.tmpdir(), `sipag-pix-${Date.now()}.csv`);
  const conteudo = [
    'Relatório de vendas pix',
    'Estabelecimento(s);CB-106145980001',
    'Estabelecimento;Data da Venda;Status;Código da Transação;Nº Terminal;Nome do Pagador;Valor Reembolsado;Valor da Venda',
    'CB-106145980001;25/08/2026 10:14:55;LIQUIDADA;ABC123PIX;20328860;PAGADOR TESTE;-;R$ 27,37',
    '',
    'Total;;;;;;R$ 0,00;R$ 27,37',
  ].join('\r\n');
  await fs.writeFile(arquivo, `\uFEFF${conteudo}`, 'utf8');
  try {
    const resultado = await parseSipagVendasPixCsv('imp-1', arquivo, 'relatorio_vendas_pix.csv');
    assert.equal(resultado.registros_brutos.length, 1);
    assert.equal(resultado.vendas_adquirentes.length, 1);
    const venda = resultado.vendas_adquirentes[0];
    assert.equal(venda.valor_bruto, '27.37');
    assert.equal(venda.valor_taxa, '0.00');
    assert.equal(venda.valor_liquido, '27.37');
    assert.equal(venda.percentual_taxa, '0.0000');
    assert.equal(venda.status_transacao_original, 'LIQUIDADA');
    assert.equal(venda.status_transacao, 'AUTORIZADO');
    assert.equal(venda.nsu, '');
    assert.equal(venda.dados_json.codigo_transacao_pix, 'ABC123PIX');
    assert.equal(resultado.registros_brutos[0].valor_reembolsado, '-');
  } finally {
    await fs.unlink(arquivo).catch(() => undefined);
  }
});
