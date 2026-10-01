import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const fonte = readFileSync(resolve(process.cwd(), 'src/repositories/repositorio.ts'), 'utf8');

test('listagem PostgreSQL de adquirentes responde os dados canônicos sem conversões', () => {
  const inicio = fonte.indexOf('export async function listarVendasAdquirentesComExibicao');
  const fim = fonte.indexOf('export async function listarConversoes', inicio);
  const bloco = fonte.slice(inicio, fim);
  assert.doesNotMatch(bloco, /sincronizarCatalogoBinsPostgres\(\)/);
  assert.doesNotMatch(bloco, /aplicarConversoesEmLinhaComRegras\('vendas_adquirentes'/);
  assert.match(bloco, /return listarVendasPostgres/);
});

test('filtro e opções de bandeira usam exclusivamente dados.bandeira', () => {
  assert.match(fonte, /function bandeiraListagemSql/);
  const inicio = fonte.indexOf('function bandeiraListagemSql');
  const fim = fonte.indexOf('function sqlValorNaoAplica', inicio);
  const bloco = fonte.slice(inicio, fim);
  assert.match(bloco, /dados->>'bandeira'/);
  assert.doesNotMatch(bloco, /catalogo_bins/);
  assert.match(fonte, /valoresDistintosPostgres\(config, bandeiraListagemSql\(config\)/);
});

test('chave complementar SIPAG prioriza o estabelecimento original preservado', () => {
  const bloco = readFileSync(resolve(process.cwd(), 'src/services/sipag-complementacao.ts'), 'utf8');
  assert.match(bloco, /d\.codigo_estabelecimento_original/);
  assert.match(bloco, /d\['Nº Estabelecimento'\]/);
});

test('importação SIPAG não sincroniza catálogo BIN e a face financeira fornece a bandeira', () => {
  const inicioSalvar = fonte.indexOf('export async function salvarVendasAdquirentes');
  const fimSalvar = fonte.indexOf('async function recalcularPercentualTaxaPostgres', inicioSalvar);
  assert.doesNotMatch(fonte.slice(inicioSalvar, fimSalvar), /sincronizarCatalogoBinsPostgres/);
  const complemento = readFileSync(resolve(process.cwd(), 'src/services/sipag-complementacao.ts'), 'utf8');
  assert.match(complemento, /bandeira: financeiro\?\.bandeira/);
});

test('conversões distinguem explicitamente o modo global administrativo do lote automático', () => {
  const rotas = readFileSync(resolve(process.cwd(), 'src/routes/core.routes.ts'), 'utf8');
  const servidor = readFileSync(resolve(process.cwd(), 'src/server.ts'), 'utf8');
  assert.match(rotas, /normalizarVendasAdquirentesExistentes\(\{ modo: 'GLOBAL' \}\)/);
  assert.match(servidor, /normalizarVendasAdquirentesExistentes\(\{ modo: 'LOTE', importacaoIds \}\)/);
  assert.match(fonte, /modo === 'LOTE' && importacaoIds\.length === 0/);
});

test('transformação de data usa parâmetro tipado do lote e possui índice de escopo', () => {
  const bootstrap = readFileSync(resolve(process.cwd(), 'src/database/bootstrap.ts'), 'utf8');
  const inicio = fonte.indexOf("if (tipoConversao(regra) === 'TRANSFORMACAO_DATA')");
  const fim = fonte.indexOf('} else {', inicio);
  const blocoData = fonte.slice(inicio, fim);
  assert.match(blocoData, /ANY\(\$6::text\[\]\)/);
  assert.doesNotMatch(blocoData, /\$8::text\[\]/);
  assert.match(bootstrap, /idx_\$\{tabela\}_escopo_importacao/);
});
