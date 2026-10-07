import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const repositorio = readFileSync(path.resolve(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
const main = readFileSync(path.resolve(raizBackend, '../frontend/src/main.tsx'), 'utf8');
const relatorios = readFileSync(path.resolve(raizBackend, '../frontend/src/pages/RelatoriosAdquirentesPage.tsx'), 'utf8');
const shell = readFileSync(path.resolve(raizBackend, '../frontend/src/components/AppShell.tsx'), 'utf8');
const atividade = readFileSync(path.resolve(raizBackend, 'src/services/atividade-segundo-plano.ts'), 'utf8');

test('v0.1.209 prioriza candidatos manuais somente pela diferença de valor', () => {
  const inicio = repositorio.indexOf('export async function listarCandidatosConciliacaoManual');
  const fim = repositorio.indexOf('export async function criarConciliacaoManual', inicio);
  const funcao = repositorio.slice(inicio, fim);
  assert.match(funcao, /CASE WHEN \$\{sqlValorCentavos\('a'\)\}=\$\{valorReferencia\} THEN 0 ELSE 1 END/);
  assert.match(funcao, /ABS\(\$\{sqlValorCentavos\('a'\)\}-\$\{valorReferencia\}\)/);
  assert.doesNotMatch(funcao, /pontuacoes|prioridadeClassificacao|prioridadeEstrategia/);
});

test('v0.1.209 compacta identificadores e usa logos de bandeira nas filas manuais', () => {
  assert.match(main, /className="manual-id-column coluna-limitavel"[^>]+title="NSU"/);
  assert.match(main, /className="manual-id-value" title=\{valorTabela\(v\.nsu\)\}/);
  assert.ok((main.match(/<RenderBandeiraLogo valor=\{v\.bandeira\}\/\>/g) || []).length >= 2);
});

test('v0.1.209 consolida bandeiras vazias em Outras e oferece tela cheia nos dois cards', () => {
  assert.match(repositorio, /IN \('NAOINFORMADO','OUTRA','OUTRAS'\) THEN 'OUTRAS'/);
  assert.match(relatorios, /Math\.abs\(item\.bruto\) \+ Math\.abs\(item\.taxa\) \+ Math\.abs\(item\.liquido\) > 0/);
  assert.match(relatorios, /cardTelaCheia === 'bandeiras'/);
  assert.match(relatorios, /cardTelaCheia === 'matriz'/);
  assert.match(relatorios, /Sair do modo tela cheia/);
});

test('v0.1.209 compartilha atividade de conversão e conciliação entre frontends', () => {
  assert.match(atividade, /'conversoes'/);
  assert.match(atividade, /'conciliacao'/);
  assert.match(shell, /Possíveis atrasos nas próximas solicitações/);
  assert.match(shell, /api\/importacoes\/fila\/status/);
});
