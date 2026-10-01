import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCoopcertoCabalVendasCsv } from '../src/parsers/coopcerto-cabal-vendas-csv.js';

const cabecalho = 'Nº do estabelecimento;Data da transação;Nº da transação;ID Venda;Bandeira;Forma de Pagamento;Plano de venda;Parcela;Total de parcela;Número da autorização;Tipo cartão;Número do cartão;Número do terminal;Tipo captura;Indicador Crédito/Débito;Indicador de cancelamento da venda;Nº resumo da venda;Data prevista de liquidação;Seu número;Nº ordem de pagamento;Status;Valor parcela bruto;Desconto parcela;Valor parcela liquido;Total plano de venda';

test('COOPCERTO/CABAL preserva bruto e projeta processada/pendente corretamente', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coopcerto-cabal-'));
  const arquivo = path.join(dir, 'vendas.csv');
  const conteudo = [
    '\uFEFFRelatório de vendas',
    'Estabelecimento(s);CB-14211625000',
    cabecalho,
    'CB-14211625000;24/08/2026 20:34:53;3864866057;RRN: abc;Cabal;Voucher;Alimentação;1;1;722556;Cabal Vale Alimentação;604220******3332;00000008;POS;C;000;-;08/09/2026;-;-;Transação Processada;R$ 242,73;R$ 8,50;R$ 234,23;R$ 242,73',
    'CB-14211625000;24/08/2026 20:04:02;-;RRN: pend;Cabal;Voucher;Alimentação;0;1;721478;Cabal Vale Alimentação;604220******8544;APT2FA4D;POS;C;000;-;;-;-;Transação Pendente de Processamento;R$ 812,85;R$ 0,00;R$ 0,00;R$ 812,85',
    'Total;;;;;;;;;;;;;;;;;;;;;R$ 1.055,58;R$ 8,50;R$ 234,23;R$ 1.055,58',
  ].join('\n');
  await fs.writeFile(arquivo, conteudo, 'utf8');
  const resultado = await parseCoopcertoCabalVendasCsv('imp-1', arquivo, 'vendas.csv');
  assert.equal(resultado.registros_brutos.length, 2);
  assert.equal(resultado.vendas_adquirentes.length, 2);
  assert.equal(resultado.vendas_adquirentes[0].adquirente, 'COOPCERTO');
  assert.equal(resultado.vendas_adquirentes[0].bandeira, 'CABAL');
  assert.equal(resultado.vendas_adquirentes[0].modalidade, 'VOUCHER');
  assert.equal(resultado.vendas_adquirentes[0].status_transacao, 'AUTORIZADO');
  assert.equal(resultado.vendas_adquirentes[0].valor_taxa, '8.50');
  assert.equal(resultado.vendas_adquirentes[0].valor_liquido, '234.23');
  assert.equal(resultado.vendas_adquirentes[1].status_transacao, 'PENDENTE_PROCESSAMENTO');
  assert.equal(resultado.vendas_adquirentes[1].nsu, '');
  assert.equal(resultado.vendas_adquirentes[1].valor_liquido, '0.00');
  assert.match(resultado.vendas_adquirentes[1].chave_semantica_coopcerto || '', /^COOPCERTO\|CB-14211625000\|RRN: PEND\|0\/1$/);
  await fs.rm(dir, { recursive: true, force: true });
});
