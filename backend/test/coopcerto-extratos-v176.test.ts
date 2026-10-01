import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseCoopcertoExtratoCsv } from '../src/parsers/coopcerto-extratos-csv.js';
import { classificarArquivo } from '../src/services/classifier.service.js';

const cabecalhoBase = 'Nº do estabelecimento;Data da transação;Nº da transação;ID Venda;Bandeira;Forma de Pagamento;Plano de venda;Parcela;Total de parcela;Número da autorização;Tipo cartão;Número do cartão;Número do terminal;Tipo captura;Indicador Crédito/Débito;Indicador de cancelamento da venda;Nº resumo da venda;Data prevista de liquidação;Seu número;Nº ordem de pagamento;Status';

test('classifica e preserva extrato COOPCERTO de vendas a receber sem criar venda canônica', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coopcerto-a-receber-'));
  const arquivo = path.join(dir, 'vendas_a_receber_relatorio_detalhado.csv');
  const conteudo = [
    '\uFEFFRelatório de vendas',
    'Estabelecimento(s);CB-142116250001',
    `${cabecalhoBase};Valor parcela bruto;Desconto parcela;Valor parcela liquido;Total plano de venda`,
    'CB-142116250001;27/08/2026 19:00:47;3872571014;RRN: 1zroauh8qimb;Cabal;Voucher;Alimentação;1;1;861963;Cabal Vale Alimentação;604220******1801;00000003;POS;C;000;-;11/09/2026;-;-;-;R$ 10,99;R$ 0,38;R$ 10,61;R$ 10,99',
    'Total;;;;;;;;;;;;;;;;;;;;;R$ 10,99;R$ 0,38;R$ 10,61;R$ 10,99',
  ].join('\n');
  await fs.writeFile(arquivo, conteudo, 'utf8');
  const classificacao = await classificarArquivo(arquivo, path.basename(arquivo));
  assert.equal(classificacao.origem_detectada, 'COOPCERTO');
  assert.equal(classificacao.layout_detectado, 'COOPCERTO_EXTRATO_VENDAS_A_RECEBER');
  const resultado = await parseCoopcertoExtratoCsv('imp-a', arquivo, path.basename(arquivo), 'VENDAS_A_RECEBER');
  assert.equal(resultado.registros_brutos.length, 1);
  assert.equal(resultado.registros_brutos[0].codigo_estabelecimento, '142116250001');
  assert.equal(resultado.registros_brutos[0].data_prevista_liquidacao, '2026-09-11');
  assert.equal(resultado.registros_brutos[0].valor_parcela_liquido, 'R$ 10,61');
  assert.equal('vendas_adquirentes' in resultado, false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('classifica e preserva extrato COOPCERTO de vendas recebidas com dados bancários', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coopcerto-recebidas-'));
  const arquivo = path.join(dir, 'vendas_recebidas_relatorio_detalhado.csv');
  const conteudo = [
    '\uFEFFRelatório de vendas recebidas',
    'Estabelecimento(s);CB-142116250001',
    `${cabecalhoBase};Data do pagamento;Nº do banco;Nº da agência;Nº da conta;Valor parcela bruto;Desconto parcela;Valor parcela liquido;Total plano de venda`,
    'CB-142116250001;13/08/2026 19:37:47;3834955347;RRN: 1zqar5coisxe;Cabal;Voucher;Alimentação;1;1;136283;Cabal Vale Alimentação;604220******3267;00000005;POS;C;000;-;28/08/2026;-;-;Pagamento Realizado;28/08/2026;756;3271;2321351;R$ 17,27;R$ 0,60;R$ 16,67;R$ 17,27',
    'Total;;;;;;;;;;;;;;;;;;;;;;;;;R$ 17,27;R$ 0,60;R$ 16,67;R$ 17,27',
  ].join('\n');
  await fs.writeFile(arquivo, conteudo, 'utf8');
  const classificacao = await classificarArquivo(arquivo, path.basename(arquivo));
  assert.equal(classificacao.origem_detectada, 'COOPCERTO');
  assert.equal(classificacao.layout_detectado, 'COOPCERTO_EXTRATO_VENDAS_RECEBIDAS');
  const resultado = await parseCoopcertoExtratoCsv('imp-r', arquivo, path.basename(arquivo), 'VENDAS_RECEBIDAS');
  assert.equal(resultado.registros_brutos[0].data_pagamento, '2026-08-28');
  assert.equal(resultado.registros_brutos[0].numero_banco, '756');
  assert.equal(resultado.registros_brutos[0].numero_agencia, '3271');
  assert.equal(resultado.registros_brutos[0].numero_conta, '2321351');
  await fs.rm(dir, { recursive: true, force: true });
});

test('relatório multibandeira do mesmo portal continua classificado como SIPAG', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sipag-recebidas-regressao-'));
  const arquivo = path.join(dir, 'relatorio_vendas_recebidas_detalhadas.csv');
  const conteudo = [
    '\uFEFFRelatório de vendas recebidas',
    'Estabelecimento(s);CB-106145980001',
    `${cabecalhoBase};Data do pagamento;Nº do banco;Nº da agência;Nº da conta;Valor parcela bruto;Desconto parcela;Valor parcela liquido;Total plano de venda`,
    'CB-106145980001;25/08/2026 21:11:03;3867200183;RRN: 000708567995;Visa;Débito;A vista;1;1;176264;Visa Platinum;498401******2916;00000006;TEF;C;000;-;26/08/2026;-;-;Pagamento Realizado;26/08/2026;756;3271;335053;R$ 7,99;R$ 0,06;R$ 7,93;R$ 7,99',
  ].join('\n');
  await fs.writeFile(arquivo, conteudo, 'utf8');
  const classificacao = await classificarArquivo(arquivo, path.basename(arquivo));
  assert.equal(classificacao.origem_detectada, 'SIPAG');
  assert.equal(classificacao.layout_detectado, 'SIPAG_EXTRATO_VENDAS_RECEBIDAS');
  await fs.rm(dir, { recursive: true, force: true });
});
