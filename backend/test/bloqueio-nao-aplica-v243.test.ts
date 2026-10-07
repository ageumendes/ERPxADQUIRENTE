import assert from 'node:assert/strict';
import test from 'node:test';
import { documentoNaoAplica, filtrarSaidaNaoAplica } from '../src/http/bloqueio-nao-aplica.js';

test('barreira de saída bloqueia documentos NÃO APLICA em listas, detalhes e auditorias sem alterar origem', () => {
  for (const valor of ['NÃO APLICA','nao aplica',' NAO_APLICA ', 'Não-Aplica']) assert.equal(documentoNaoAplica(valor),true);
  assert.equal(documentoNaoAplica('12345678901'),false);
  const proibido={id:'bloqueado',pagador_documento:'NÃO APLICA',valor_bruto:'500'};
  const permitido={id:'permitido',pagador_documento:'12345678901'};
  const original={linhas:[proibido,permitido],conciliacoes:[{id:'c',venda_adquirente:proibido}],auditoria:[{dados:proibido}],detalhes:proibido};
  assert.deepEqual(filtrarSaidaNaoAplica(original), {linhas:[permitido],conciliacoes:[],auditoria:[],detalhes:null});
  assert.equal(original.linhas.length,2);
  assert.equal(original.detalhes.pagador_documento,'NÃO APLICA');
});
