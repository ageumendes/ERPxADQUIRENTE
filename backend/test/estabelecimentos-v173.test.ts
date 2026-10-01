import test from 'node:test';
import assert from 'node:assert/strict';
import { identificarEstabelecimentoVenda, enriquecerEstabelecimentoVenda } from '../src/services/estabelecimento.service.js';

test('identifica estabelecimentos específicos sem usar documento do pagador', () => {
  assert.equal(identificarEstabelecimentoVenda({ adquirente:'CIELO',dados_json:{estabelecimento_submissor:'0001234567'} })?.valor,'0001234567');
  assert.equal(identificarEstabelecimentoVenda({ adquirente:'VR',dados_json:{codigo_filiacao:'00045',cnpj_loja:'27752608000129'} })?.valor,'00045');
  assert.equal(identificarEstabelecimentoVenda({ adquirente:'SICOOB',dados_json:{pagador_documento:'27752608000129'} }),null);
});

test('enriquece a venda futura preservando origem auditável', () => {
  const venda = enriquecerEstabelecimentoVenda({ adquirente:'CONVCARD',dados_json:{cnpj_loja:'27.752.608/0001-29'} });
  assert.equal(venda.codigo_estabelecimento,'27752608000129');
  assert.equal(venda.dados_json?.['codigo_estabelecimento_origem'],'cnpj_loja');
});
