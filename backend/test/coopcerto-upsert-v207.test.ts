import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { VendaAdquirente } from '../src/repositorio.js';
import {
  chaveSemanticaCoopcerto,
  mergeAtualizacaoCoopcerto,
  planejarAtualizacoesCoopcerto,
} from '../src/services/coopcerto-upsert.js';

function venda(id: string, patch: Partial<VendaAdquirente> = {}): VendaAdquirente {
  return {
    id,
    importacao_id: `imp-${id}`,
    adquirente: 'COOPCERTO',
    layout_origem: 'coopcerto_cabal_vendas_csv',
    tipo_arquivo: 'COOPCERTO_CABAL_VENDAS_CSV',
    codigo_registro: 'VENDA',
    numero_linha: 4,
    data_venda: '2026-09-14',
    hora_venda: '18:57:31',
    valor_bruto: '184.53',
    valor_taxa: '0.00',
    percentual_taxa: '0.0000',
    valor_liquido: '0.00',
    nsu: '',
    codigo_autorizacao: '',
    terminal: '00000008',
    bandeira: 'CABAL',
    modalidade: 'VOUCHER',
    parcelas: '1/1',
    status_transacao: 'PENDENTE_PROCESSAMENTO',
    status_transacao_original: 'Transação Pendente de Processamento',
    hash_linha: `hash-${id}`,
    linha_original: id,
    dados_json: {
      'Nº do estabelecimento': 'CB-14211625000',
      'ID Venda': 'RRN: venda-estavel',
      'Nº da transação': '-',
      id_venda_rrn: 'RRN: venda-estavel',
      numero_transacao: '-',
    },
    data_criacao: '2026-09-14T19:00:00.000Z',
    ...patch,
  };
}

function autorizada(id = 'autorizada') {
  return venda(id, {
    nsu: '3922577721',
    codigo_autorizacao: '7721',
    valor_taxa: '6.46',
    percentual_taxa: '3.5000',
    valor_liquido: '178.07',
    status_transacao: 'AUTORIZADO',
    status_transacao_original: 'Transação Processada',
    dados_json: {
      ...venda(id).dados_json,
      'Nº da transação': '3922577721',
      numero_transacao: '3922577721',
    },
  });
}

test('chave COOPCERTO permanece igual quando o NSU nasce na autorização', () => {
  assert.equal(chaveSemanticaCoopcerto(venda('pendente')), chaveSemanticaCoopcerto(autorizada()));
  assert.ok(chaveSemanticaCoopcerto(venda('pendente')).includes('RRN: VENDA-ESTAVEL'));
});

test('pendente vira autorizada no mesmo ID e conserva a conciliação', () => {
  const pendente = venda('pendente', {
    conciliacao_id: 'conc-1', status_conciliacao: 'CONCILIADO', score_conciliacao: 100,
  });
  const atualizada = mergeAtualizacaoCoopcerto(pendente, autorizada());
  assert.equal(atualizada.id, 'pendente');
  assert.equal(atualizada.importacao_id, 'imp-pendente');
  assert.equal(atualizada.conciliacao_id, 'conc-1');
  assert.equal(atualizada.status_conciliacao, 'CONCILIADO');
  assert.equal(atualizada.status_transacao, 'AUTORIZADO');
  assert.equal(atualizada.nsu, '3922577721');
  assert.equal(atualizada.valor_taxa, '6.46');
  assert.equal(atualizada.valor_liquido, '178.07');
  assert.equal((atualizada.dados_json.historico_status_coopcerto as any[]).length, 1);
});

test('fotografia pendente antiga não rebaixa autorização e cancelamento prevalece', () => {
  const atual = autorizada();
  assert.equal(mergeAtualizacaoCoopcerto(atual, venda('velha')), atual);
  const cancelada = venda('cancelada', {
    status_transacao: 'CANCELADO', status_transacao_original: 'Transação Cancelada',
    valor_liquido: '0.00', valor_taxa: '0.00',
  });
  const final = mergeAtualizacaoCoopcerto(atual, cancelada);
  assert.equal(final.status_transacao, 'CANCELADO');
  assert.equal(mergeAtualizacaoCoopcerto(final, autorizada('antiga')), final);
});

test('reimportação é idempotente e vendas com RRN diferentes não são unidas', () => {
  const pendente = venda('pendente');
  const primeira = planejarAtualizacoesCoopcerto([{ row_id: pendente.id, dados: pendente }], [autorizada()]);
  assert.equal(primeira.novos.length, 0);
  assert.equal(primeira.updates.size, 1);
  const consolidada = primeira.updates.get('pendente')!;
  const repetida = planejarAtualizacoesCoopcerto([{ row_id: pendente.id, dados: consolidada }], [autorizada()]);
  assert.equal(repetida.novos.length, 0);
  assert.equal(repetida.updates.size, 0);

  const outra = autorizada('outra');
  outra.dados_json = { ...outra.dados_json, 'ID Venda': 'RRN: outra-venda', id_venda_rrn: 'RRN: outra-venda' };
  const separadas = planejarAtualizacoesCoopcerto([], [autorizada(), outra]);
  assert.equal(separadas.novos.length, 2);
});

test('duas conciliações distintas bloqueiam consolidação automática', () => {
  const a = venda('a', { conciliacao_id: 'conc-a', status_conciliacao: 'CONCILIADO' });
  const b = autorizada('b');
  b.conciliacao_id = 'conc-b'; b.status_conciliacao = 'CONCILIADO';
  const plano = planejarAtualizacoesCoopcerto([{ row_id: 'a', dados: a }, { row_id: 'b', dados: b }], [autorizada('nova')]);
  assert.equal(plano.conflitos, 1);
  assert.equal(plano.updates.size, 0);
  assert.equal(plano.substituidos.size, 0);
  assert.equal(plano.novos.length, 0);
});

test('índice COOPCERTO é criado somente depois do COMMIT da migração', async () => {
  const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const bootstrap = await readFile(path.resolve(raizBackend, 'src/database/bootstrap.ts'), 'utf8');
  const inicio = bootstrap.indexOf('const migration207Coopcerto');
  const fim = bootstrap.indexOf("['0.1.47'", inicio);
  const trecho = bootstrap.slice(inicio, fim);
  const commit = trecho.indexOf("await pool.query('COMMIT')");
  const indice = trecho.indexOf('CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_chave_coopcerto');
  assert.ok(inicio >= 0 && fim > inicio);
  assert.ok(commit >= 0 && indice > commit, 'CREATE INDEX deve ocorrer depois do COMMIT');
});
