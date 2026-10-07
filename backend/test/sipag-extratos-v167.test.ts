import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseSipagExtratoCsv } from '../src/parsers/sipag-extratos-csv.js';

async function arquivoTemporario(nome: string, conteudo: string) {
  const pasta = await mkdtemp(path.join(os.tmpdir(), 'sipag-extrato-'));
  const arquivo = path.join(pasta, nome);
  await writeFile(arquivo, `\uFEFF${conteudo.replace(/\n/g, '\r\n')}`, 'utf8');
  return arquivo;
}

test('extrato de autorizações preserva todas as linhas brutas e gera venda apenas para NEGADO', async () => {
  const arquivo = await arquivoTemporario('relatorio_transacoes_autorizadas.csv', [
    'Relatório de autorizações', 'Estabelecimento(s);CB-106145980001',
    'Nº Estabelecimento;Autorização;Situação;Documento;Nº terminal;Nº cartão;Tipo;Forma de Pagamento;Nº comprovante;Data Autorização;Valor da transação',
    '106145980001;145680;APROVADA;27.***.***/0001-29;00000008;466070******4225;Venda;DEBITO;500002;2026-08-26T07:39:05;R$ 29,35',
    '106145980001;145681;RECUSADA;27.***.***/0001-29;00000008;466070******4225;Venda;DEBITO;500003;2026-08-26T07:40:05;R$ 19,35',
    '106145980001;145682;CANCELADA;27.***.***/0001-29;00000008;466070******4225;Venda;DEBITO;500004;2026-08-26T07:41:05;R$ 10,00',
    'Total;;;;;;;;;;R$ 29,35',
  ].join('\n'));
  const resultado = await parseSipagExtratoCsv('imp-1', arquivo, path.basename(arquivo));
  assert.equal(resultado.tipo, 'TRANSACOES_AUTORIZADAS');
  assert.equal(resultado.registros_brutos.length, 3);
  assert.equal(resultado.vendas_adquirentes.length, 1);
  assert.equal(resultado.vendas_adquirentes[0].codigo_estabelecimento, '106145980001');
  assert.equal(resultado.vendas_adquirentes[0].status_transacao, 'NEGADO');
  assert.equal(resultado.vendas_adquirentes[0].bandeira, '');
  assert.equal(resultado.registros_brutos[1].bandeira, undefined);
  assert.equal((resultado.registros_brutos[1].dados_json as Record<string,unknown>)['Nº cartão'], '466070******4225');
  assert.equal(resultado.vendas_adquirentes[0].dados_json.bin_cartao, undefined);
});

test('extrato de autorizações preserva cartão original sem inferir bandeira', async () => {
  const arquivo = await arquivoTemporario('relatorio_transacoes_bandeiras.csv', [
    'Relatório de autorizações', 'Estabelecimento(s);CB-106145980001',
    'Nº Estabelecimento;Autorização;Situação;Documento;Nº terminal;Nº cartão;Tipo;Forma de Pagamento;Nº comprovante;Data Autorização;Valor da transação',
    '106145980001;A1;APROVADA;27.***.***/0001-29;1;512707******4509;Venda;CREDITO;1;2026-08-26T07:39:05;R$ 10,00',
    '106145980001;A2;APROVADA;27.***.***/0001-29;1;650722******6153;Venda;DEBITO;2;2026-08-26T07:40:05;R$ 20,00',
    '106145980001;A3;APROVADA;27.***.***/0001-29;1;604220******3332;Venda;VOUCHER;3;2026-08-26T07:41:05;R$ 30,00',
    '106145980001;A4;APROVADA;27.***.***/0001-29;1;603389******9753;Venda;VOUCHER;4;2026-08-26T07:42:05;R$ 40,00',
    '106145980001;A5;APROVADA;27.***.***/0001-29;1;637036******4876;Venda;VOUCHER;5;2026-08-26T07:43:05;R$ 50,00',
    'Total;;;;;;;;;;R$ 150,00',
  ].join('\n'));
  const resultado = await parseSipagExtratoCsv('imp-bandeiras', arquivo, path.basename(arquivo));
  assert.equal(resultado.vendas_adquirentes.length, 0);
  assert.equal(resultado.registros_brutos.length, 5);
  assert.equal((resultado.registros_brutos[0].dados_json as Record<string,unknown>)['Nº cartão'], '512707******4509');
  assert.ok(resultado.registros_brutos.every(r => r.bandeira === undefined && r.bin_cartao === undefined));
});

test('extrato PIX normaliza prefixo CB e gera venda PIX', async () => {
  const arquivo = await arquivoTemporario('relatorio_vendas_pix.csv', [
    'Relatório de vendas pix', 'Estabelecimento(s);CB-116403700001',
    'Estabelecimento;Data da Venda;Status;Código da Transação;Nº Terminal;Nome do Pagador;Valor Reembolsado;Valor da Venda',
    'CB-116403700001;01/08/2026 08:14:55;LIQUIDADA;CODIGO123;21118969;PAGADOR;-;R$ 9,98',
    'Total;;;;;;R$ 0,00;R$ 9,98',
  ].join('\n'));
  const resultado = await parseSipagExtratoCsv('imp-2', arquivo, path.basename(arquivo));
  assert.equal(resultado.tipo, 'VENDAS_PIX');
  assert.equal(resultado.vendas_adquirentes[0].codigo_estabelecimento, '116403700001');
  assert.equal(resultado.vendas_adquirentes[0].modalidade, 'PIX');
});

test('extratos a receber e recebidos ficam nas tabelas brutas sem duplicar vendas', async () => {
  const cabecalhoBase = 'Nº do estabelecimento;Data da transação;Nº da transação;ID Venda;Bandeira;Forma de Pagamento;Plano de venda;Parcela;Total de parcela;Número da autorização;Tipo cartão;Número do cartão;Número do terminal;Tipo captura;Indicador Crédito/Débito;Indicador de cancelamento da venda;Nº resumo da venda;Data prevista de liquidação;Seu número;Nº ordem de pagamento;Status';
  const receber = await arquivoTemporario('vendas_a_receber.csv', ['Relatório de vendas','Estabelecimento(s);CB-106145980001',`${cabecalhoBase};Valor parcela bruto;Desconto parcela;Valor parcela liquido;Total plano de venda`,'CB-106145980001;27/08/2026 21:01:54;3872289541;RRN: 1;Mastercard;Débito;A vista;1;1;187438;Standard;5127******4509;00000007;TEF;C;000;-;28/08/2026;-;-;-;R$ 12,52;R$ 0,10;R$ 12,42;R$ 12,52'].join('\n'));
  const recebidas = await arquivoTemporario('vendas_recebidas.csv', ['Relatório de vendas recebidas','Estabelecimento(s);CB-106145980001',`${cabecalhoBase};Data do pagamento;Nº do banco;Nº da agência;Nº da conta;Valor parcela bruto;Desconto parcela;Valor parcela liquido;Total plano de venda`,'CB-106145980001;25/08/2026 21:11:03;3867200183;RRN: 2;Visa;Débito;A vista;1;1;176264;Visa;4984******2916;00000006;TEF;C;000;-;26/08/2026;-;-;Pagamento Realizado;26/08/2026;756;3271;335053;R$ 7,99;R$ 0,06;R$ 7,93;R$ 7,99'].join('\n'));
  for (const [arquivo, tipo] of [[receber, 'VENDAS_REALIZADAS'], [recebidas, 'VENDAS_RECEBIDAS']] as const) {
    const resultado = await parseSipagExtratoCsv(`imp-${tipo}`, arquivo, path.basename(arquivo));
    assert.equal(resultado.tipo, tipo);
    assert.equal(resultado.registros_brutos[0].codigo_estabelecimento, '106145980001');
    assert.equal(resultado.vendas_adquirentes.length, tipo === 'VENDAS_REALIZADAS' ? 1 : 0);
  }
});


test('extrato de vendas realizadas cria uma única venda canônica para venda parcelada', async () => {
  const arquivo = await arquivoTemporario('vendas_realizadas_relatorio_detalhado.csv', [
    'Relatório de vendas', 'Estabelecimento(s);CB-106145980001',
    'Nº do estabelecimento;Data da transação;Nº da transação;ID Venda;Bandeira;Forma de Pagamento;Plano de venda;Parcela;Total de parcela;Número da autorização;Tipo cartão;Número do cartão;Número do terminal;Tipo captura;Indicador Crédito/Débito;Indicador de cancelamento da venda;Nº resumo da venda;Data prevista de liquidação;Seu número;Nº ordem de pagamento;Status;Valor parcela bruto;Desconto parcela;Valor parcela liquido;Total plano de venda',
    'CB-106145980001;28/08/2026 08:25:50;-;RRN: 000767272943;Visa;Crédito;Parcelado;1;6;019788;Visa;515894******5886;20328860;TEF;C;000;-;28/09/2026;-;-;Transação Processada;R$ 500,00;R$ 13,05;R$ 486,95;R$ 3.000,00',
    'CB-106145980001;28/08/2026 08:25:50;-;RRN: 000767272943;Visa;Crédito;Parcelado;2;6;019788;Visa;515894******5886;20328860;TEF;C;000;-;27/10/2026;-;-;Transação Processada;R$ 500,00;R$ 13,05;R$ 486,95;R$ 3.000,00',
  ].join('\n'));
  const resultado = await parseSipagExtratoCsv('imp-vendas', arquivo, path.basename(arquivo));
  assert.equal(resultado.tipo, 'VENDAS_REALIZADAS');
  assert.equal(resultado.vendas_adquirentes.length, 1);
  assert.equal(resultado.vendas_adquirentes[0].valor_bruto, '3000.00');
  assert.equal(resultado.vendas_adquirentes[0].parcelas, '6x');
  assert.equal(resultado.vendas_adquirentes[0].nsu, '000767272943');
});
