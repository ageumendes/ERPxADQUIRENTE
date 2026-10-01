import assert from 'node:assert/strict';
import test from 'node:test';
import { avaliarCandidatoHibrido, formatarDiferencaHorario, modalidadesCompativeis, normalizarModalidade, normalizarNsu, valorEmCentavos } from '../src/services/conciliacao-hibrida.js';

const erp = (extra: Record<string, unknown> = {}) => ({ id: 'E1', cnpj_estabelecimento: '27752608000129', data_venda: '2026-07-20', hora_venda: '10:30', valor_bruto: '100,00', nsu: '000123', tipo_produto: 'CREDITO', parcelas: '1/1', ...extra });
const adq = (extra: Record<string, unknown> = {}) => ({ id: 'A1', codigo_estabelecimento: '27752608000129', adquirente: 'CIELO', data_venda: '2026-07-20', hora_venda: '11:31:00', valor_bruto: '100.00', nsu: '999', modalidade: 'CREDITO A VISTA', parcelas: '1/1', ...extra });

test('normaliza NSU, moeda e modalidades brasileiras', () => {
  assert.equal(normalizarNsu('000-123'), '123');
  assert.equal(valorEmCentavos('R$ 1.234,56'), 123456);
  assert.equal(normalizarModalidade('Crédito à vista'), 'CREDITO');
  assert.equal(normalizarModalidade('CARTEIRA DIGITAL'), 'PIX');
  assert.equal(modalidadesCompativeis('cartão de débito', 'DEBITO'), true);
  assert.equal(formatarDiferencaHorario(14528), '4h02min08s');
});

test('SIPAG usa NSU + valor + data como match exato', () => {
  const resultado = avaliarCandidatoHibrido(adq({ adquirente: 'SIPAG', nsu: '123' }), erp());
  assert.equal(resultado?.classificacao, 'MATCH_EXATO_NSU');
  assert.equal(resultado?.score, 100);
});

test('estabelecimento é a primeira barreira obrigatória do motor híbrido', () => {
  assert.equal(avaliarCandidatoHibrido(adq({ codigo_estabelecimento: '' }), erp()), null);
  assert.equal(avaliarCandidatoHibrido(adq({ codigo_estabelecimento: '27752608000200' }), erp()), null);
  assert.ok(avaliarCandidatoHibrido(adq(), erp()));
});

test('CIELO corrige uma hora e aceita tolerância segura de dois minutos', () => {
  const resultado = avaliarCandidatoHibrido(adq(), erp());
  assert.equal(resultado?.classificacao, 'MATCH_EXATO_HORARIO');
  assert.equal(resultado?.diferenca_segundos, 60);
});

test('diferença acima de dois minutos entra na janela de até 8 horas', () => {
  const resultado = avaliarCandidatoHibrido(adq({ hora_venda: '11:34:00' }), erp());
  assert.equal(resultado?.classificacao, 'CANDIDATO_UNICO_JANELA_8H');
  assert.equal(resultado?.score, 80);
});

test('rejeita diferença normalizada superior a 8 horas', () => {
  assert.equal(avaliarCandidatoHibrido(adq({ hora_venda: '20:31:01' }), erp()), null);
});

test('aceita cruzamento D/D+1 quando o instante normalizado está dentro da janela', () => {
  const resultado = avaliarCandidatoHibrido(
    adq({ adquirente: 'SICOOB', data_venda: '2026-08-06', hora_venda: '00:09:21', valor_bruto: '25,97', modalidade: 'CARTEIRA DIGITAL' }),
    erp({ data_venda: '2026-08-05', hora_venda: '20:09:00', valor_bruto: '25,97', tipo_produto: 'CARTEIRA DIGITAL' }),
  );
  assert.equal(resultado?.classificacao, 'MATCH_EXATO_HORARIO');
  assert.equal(resultado?.diferenca_segundos, 21);
});

test('SICOOB PIX corrige quatro horas', () => {
  const resultado = avaliarCandidatoHibrido(adq({ adquirente: 'SICOOB', hora_venda: '14:30:04', modalidade: 'PIX' }), erp({ hora_venda: '10:30:00', tipo_produto: 'PIX' }));
  assert.equal(resultado?.classificacao, 'MATCH_EXATO_HORARIO');
  assert.equal(resultado?.diferenca_segundos, 4);
});

test('SICOOB PIX com horário La Paz já convertido não recebe segundo ajuste', () => {
  const resultado = avaliarCandidatoHibrido(
    adq({ adquirente: 'SICOOB', hora_venda: '10:30:04', modalidade: 'PIX', horario_fuso_aplicado: 'America/La_Paz' }),
    erp({ hora_venda: '10:30:00', tipo_produto: 'PIX' }),
  );
  assert.equal(resultado?.classificacao, 'MATCH_EXATO_HORARIO');
  assert.equal(resultado?.diferenca_segundos, 4);
  assert.equal(resultado?.ajuste_horario_minutos, 0);
});

test('horário forte mantém candidato mesmo com modalidade e bandeira divergentes', () => {
  const resultado = avaliarCandidatoHibrido(
    adq({ adquirente: 'SIPAG', data_venda: '2026-08-02', hora_venda: '11:45:16', valor_bruto: '13,98', modalidade: 'DEBITO', bandeira: 'MASTERCARD' }),
    erp({ data_venda: '2026-08-02', hora_venda: '10:45:00', valor_bruto: '13,98', tipo_produto: 'CREDITO', bandeira: 'VISA' }),
  );
  assert.equal(resultado?.classificacao, 'MATCH_HORARIO_FORTE_DIVERGENTE');
  assert.equal(resultado?.score, 90);
  assert.equal(resultado?.diferenca_segundos, 16);
});

test('PLUXEE voucher com horário normalizado forte recebe score 90', () => {
  const resultado = avaliarCandidatoHibrido(
    adq({ adquirente: 'PLUXEE', data_venda: '2026-08-02', hora_venda: '11:52:55', valor_bruto: '111,80', modalidade: 'VOUCHER', bandeira: 'PLUXEE' }),
    erp({ data_venda: '2026-08-02', hora_venda: '10:53:00', valor_bruto: '111,80', tipo_produto: 'DEBITO', bandeira: 'VISA' }),
  );
  assert.equal(resultado?.classificacao, 'VOUCHER_HORARIO_FORTE');
  assert.equal(resultado?.score, 90);
  assert.equal(resultado?.diferenca_segundos, 5);
});

test('CONVCARD voucher sem horário pode virar candidato único de score 80', () => {
  const resultado = avaliarCandidatoHibrido(
    adq({ adquirente: 'CONVCARD', data_venda: '2026-08-02', hora_venda: '', valor_bruto: '363,11', modalidade: 'VOUCHER', bandeira: 'FACER' }),
    erp({ data_venda: '2026-08-02', hora_venda: '10:44:00', valor_bruto: '363,11', tipo_produto: 'CREDITO', bandeira: 'VISA' }),
  );
  assert.equal(resultado?.classificacao, 'VOUCHER_UNICO_DATA_VALOR_PARCELAS');
  assert.equal(resultado?.score, 80);
});

test('aceita data D+1 quando valor e identificadores são compatíveis', () => {
  const resultado = avaliarCandidatoHibrido(
    adq({ adquirente: 'SIPAG', data_venda: '2026-08-02', nsu: '123', parcelas: '2' }),
    erp({ data_venda: '2026-08-01', nsu: '123', parcelas: '2' }),
  );
  assert.equal(resultado?.classificacao, 'MATCH_EXATO_NSU');
  assert.ok(resultado?.criterios.includes('Data compatível (D±1)'));
  assert.ok(resultado?.criterios.includes('Parcelas iguais'));
});

test('rejeita candidato quando ambos informam parcelas diferentes', () => {
  const resultado = avaliarCandidatoHibrido(
    adq({ adquirente: 'SIPAG', nsu: '123', parcelas: '2' }),
    erp({ nsu: '123', parcelas: '3' }),
  );
  assert.equal(resultado, null);
});
