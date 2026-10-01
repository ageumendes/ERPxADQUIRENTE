import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSipagLayout20 } from '../src/parsers/sipag-layout-2-0.js';
import { parseSipagExtratoCsv } from '../src/parsers/sipag-extratos-csv.js';
import { planejarSipagComplementares, sipagChaveComplementar, type LinhaSipag } from '../src/services/sipag-complementacao.js';
import type { VendaAdquirente } from '../src/repositorio.js';

const venda = (id: string, layout: string, patch: Partial<VendaAdquirente> = {}): VendaAdquirente => ({
  id, importacao_id: id, adquirente: 'SIPAG', layout_origem: layout, tipo_arquivo: 'S',
  codigo_registro: '011', numero_linha: 1, data_criacao: '2026-09-01T00:00:00Z',
  data_venda: '2026-08-29', hora_venda: '09:20:13', codigo_estabelecimento: '106145980001',
  codigo_autorizacao: '004224', valor_bruto: '124.51', valor_taxa: '0.00', valor_liquido: '124.51',
  hash_linha: id, linha_original: id, modalidade: 'DEBITO', status_transacao: 'AUTORIZADO',
  terminal: '00000006', nsu: '24', parcelas: '1', bandeira: '',
  dados_json: { numero_cartao: '608819******1611', codigo_cliente: '106145980001' }, ...patch,
});
const auth = (id = 'a') => venda(id, 'sipag_extrato_transacoes_autorizadas', {
  status_transacao_original: 'APROVADA', dados_json: { 'Nº cartão': '608819******1611', 'Situação': 'APROVADA',
    'Nº Estabelecimento': '106145980001', 'Nº comprovante': '24' },
});
const edi = (id = 'e') => venda(id, 'sipag_layout_2_0_s_cartoes', {
  data_venda: '29082026', hora_venda: '092013', valor_taxa: '1.00', valor_liquido: '123.51',
  status_transacao: 'COMPROVANTE_DEBITO', bandeira: '005', nsu: 'EDI-24',
  dados_json: { numero_cartao: '608819******1611', codigo_cliente: '106145980001', acquirer_reference_number: '000123456789' },
});
function aplicar(atual: LinhaSipag[], lote: VendaAdquirente[]) {
  const plano = planejarSipagComplementares(atual, lote);
  return [...atual.map(r => ({ ...r, dados: plano.updates.get(r.row_id) || r.dados })),
    ...plano.novos.map(dados => ({ row_id: dados.id, dados }))];
}

test('EDI e autorização se complementam nas duas ordens e no mesmo lote; reimportação mantém uma venda', () => {
  for (const lote of [[edi(), auth()], [auth(), edi()]]) {
    for (const junto of [false, true]) {
      let rows: LinhaSipag[] = junto ? aplicar([], lote) : aplicar(aplicar([], [lote[0]]), [lote[1]]);
      rows = aplicar(rows, [auth('a2'), edi('e2')]);
      assert.equal(rows.length, 1);
      const v = rows[0].dados;
      assert.equal(v.id, lote[0].id);
      assert.equal(v.importacao_id, lote[0].importacao_id);
      assert.equal(v.ultima_importacao_id, 'e2');
      assert.equal(v.valor_taxa, '1.00');assert.equal(v.valor_liquido, '123.51');
      assert.equal(v.nsu, 'EDI-24');assert.equal(v.bandeira, '005');
      assert.equal(v.status_transacao, 'AUTORIZADO');
      assert.equal((v.dados_json as any).sipag_autorizacao['Nº comprovante'], '24');
    }
  }
});

test('taxa zero legítima do EDI não é substituída; voucher mantém modalidade da autorização', () => {
  const rows = aplicar([], [{ ...auth(), modalidade: 'VOUCHER' }, { ...edi(), modalidade: 'CREDITO', valor_taxa: '0.00', valor_liquido: '124.51' }]);
  assert.equal(rows.length, 1);assert.equal(rows[0].dados.modalidade, 'VOUCHER');assert.equal(rows[0].dados.valor_taxa, '0.00');
});

test('campo financeiro ausente no EDI conserva o valor conhecido do detalhado', () => {
  const detail = {...edi('detail'),layout_origem:'sipag_extrato_vendas_realizadas'};
  const rows = aplicar([], [detail,{...edi(),valor_taxa:undefined,valor_liquido:undefined,percentual_taxa:'0.0000'}]);
  assert.equal(rows.length,1);assert.equal(rows[0].dados.valor_taxa,'1.00');assert.equal(rows[0].dados.valor_liquido,'123.51');
  assert.equal(rows[0].dados.percentual_taxa,((1/124.51)*100).toFixed(4));
});

test('recusas são preservadas e nunca se unem a uma aprovação idêntica', () => {
  const negada = { ...auth('negada'), status_transacao: 'NEGADO', status_transacao_original: 'RECUSADA', dados_json: { ...auth().dados_json, 'Situação': 'RECUSADA' } };
  const rows = aplicar([], [edi(), auth(), negada, { ...negada, id: 'repetida', hash_linha: 'outro' }]);
  assert.equal(rows.length, 2);assert.equal(rows.filter(r => r.dados.status_transacao === 'NEGADO').length, 1);
});

test('loja convertida usa identificador original; horário/cartão distintos e dados incompletos não são aproximados', () => {
  const e = edi();e.codigo_estabelecimento = 'SRG';
  assert.equal(sipagChaveComplementar(e), sipagChaveComplementar(auth()));
  assert.equal(sipagChaveComplementar({ ...auth(), hora_venda: '' }), '');
  assert.equal(sipagChaveComplementar({ ...auth(), valor_bruto: undefined }), '');
  assert.notEqual(sipagChaveComplementar(e), sipagChaveComplementar({ ...auth(), hora_venda: '09:20:14' }));
  const rows = aplicar([], [edi(), { ...auth(), dados_json: { ...auth().dados_json, 'Nº cartão': '608819******9999' } }]);
  assert.equal(rows.length, 2);
});

test('múltiplos candidatos históricos compatíveis são consolidados e RRN conflitante continua bloqueado', () => {
  const plano = planejarSipagComplementares([{row_id:'x',dados:edi('x')},{row_id:'y',dados:auth('y')}], [auth()]);
  assert.equal(plano.substituidos.size, 1);
  assert.equal(plano.updates.size, 1);
  assert.equal(plano.novos.length, 0);
  assert.throws(() => aplicar([{row_id:'x',dados:edi('x')},{row_id:'y',dados:{...edi('y'),dados_json:{...edi().dados_json,acquirer_reference_number:'OUTRO'}}}], [auth()]), /RRN diferentes/);
  assert.throws(() => aplicar([], [edi(), { ...edi('e2'), dados_json: { ...edi().dados_json, acquirer_reference_number: 'OUTRO' } }]), /RRN diferentes/);
});

test('grupo com conciliações históricas distintas permanece intacto sem impedir as demais vendas', () => {
  const protegido = sipagChaveComplementar(auth());
  const independentes = auth('independente');
  independentes.codigo_autorizacao = 'OUTRA';
  const existentes = [{row_id:'edi-protegido',dados:edi('edi-protegido')},{row_id:'auth-protegida',dados:auth('auth-protegida')}];
  const plano = planejarSipagComplementares(existentes, [auth('nova-auth'), independentes], new Set([protegido]));
  assert.equal(plano.conflitos, 1);
  assert.equal(plano.substituidos.size, 0);
  assert.equal(plano.updates.size, 0);
  assert.deepEqual(plano.novos.map(v => v.id), ['independente']);
  assert.equal(existentes[0].dados.id, 'edi-protegido');
  assert.equal(existentes[1].dados.id, 'auth-protegida');
});

test('reimportação idêntica é contabilizada sem produzir UPDATE', () => {
  const existente = aplicar([], [auth()]);
  const plano = planejarSipagComplementares(existente, [{...auth('nova'),hash_linha:auth().hash_linha}]);
  assert.equal(plano.novos.length, 0);
  assert.equal(plano.updates.size, 0);
  assert.equal(plano.duplicados, 1);
});

test('PIX pode complementar pelo terminal exato e liquidação não retrocede', () => {
  const ativo = venda('p', 'sipag_layout_2_0_s_pix', { modalidade: 'PIX', status_transacao: '0', codigo_autorizacao: '', terminal: '20328860', dados_json: { codigo_cliente: '106145980001', end_to_end_id: '' } });
  const pago = { ...ativo, id: 'pago', hash_linha: 'pago', status_transacao: '1', dados_json: { ...ativo.dados_json, end_to_end_id: 'E123' } };
  const rows = aplicar(aplicar([], [ativo, pago]), [ativo]);
  assert.equal(rows.length, 1);assert.equal(rows[0].dados.status_transacao, 'AUTORIZADO');
  assert.equal(rows[0].dados.dados_json.end_to_end_id, 'E123');
});

test('PIX legado da v196 é reconhecido pelo terminal preservado nos campos brutos', () => {
  const antiga = venda('old', 'sipag_layout_2_0_s_pix', { modalidade:'PIX',terminal:'02038232',status_transacao:'1',
    dados_json:{codigo_cliente:'106145980001',nsu:'20328860',end_to_end_id:'E123'} });
  const nova = {...antiga,id:'new',hash_linha:'new',terminal:'20328860',dados_json:{...antiga.dados_json,terminal_original:'20328860'}};
  const rows=aplicar([{row_id:'old',dados:antiga}],[nova]);
  assert.equal(rows.length,1);assert.equal(rows[0].dados.terminal,'20328860');
});

test('parcelados diferentes com o mesmo resumo recebem somente suas parcelas, taxas e RRN', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sipag197-'));
  const arq = path.join(dir, 'SIPAG-EDI-S.csv');
  const resumo = (auth: string, card: string, hora: string, valor: string, parcela: number) => ['014','10614598','106145980001','09092026','10003','1','002','1','MCS','005',card,auth,hora,'00000008','21','M',valor,'1.00','0','09102026',`${parcela}/2`,'756','3271','005','335053','2','10'].join(',');
  const detalhe = (rrn: string, net: string, total: string, parcela: number) => ['015','106145980001','09092026','10003',rrn,'002','005','1.00',net,total,'09102026',String(parcela),rrn,'2',rrn,'11'].join(',');
  await fs.writeFile(arq, [resumo('A','111111******1111','10:00:00','100.00',1),detalhe('RRNA','49.00','98.00',1), resumo('B','222222******2222','11:00:00','200.00',1),detalhe('RRNB','99.00','198.00',1),resumo('A','111111******1111','10:00:00','100.00',2),detalhe('RRNA','49.00','98.00',2),resumo('B','222222******2222','11:00:00','200.00',2),detalhe('RRNB','99.00','198.00',2)].join('\n'));
  try {
    const r = await parseSipagLayout20('i1', arq, path.basename(arq));
    const again = await parseSipagLayout20('i2', arq, path.basename(arq));
    assert.equal(r.vendas_adquirentes.length, 2);
    assert.deepEqual(r.vendas_adquirentes.map(v => [v.nsu,v.valor_taxa,v.valor_liquido,v.dados_json.acquirer_reference_number]), [['RRNA','2.00','98.00','RRNA'],['RRNB','2.00','198.00','RRNB']]);
    assert.deepEqual(r.vendas_adquirentes.map(v => v.hash_linha), again.vendas_adquirentes.map(v => v.hash_linha));
  } finally { await fs.rm(dir, {recursive:true,force:true}); }
});

test('arquivos reais: EDI, autorizações e extratos nas duas ordens totalizam 2.969 registros', {skip: !process.env.SIPAG_TEST_INPUT}, async () => {
  const dir = process.env.SIPAG_TEST_INPUT!;
  const arquivos = await fs.readdir(dir);
  const edis = [] as VendaAdquirente[];
  for (const nome of arquivos.filter(n => n.startsWith('SIPAG-EDI-')).sort()) {
    const r = await parseSipagLayout20(nome, path.join(dir,nome), nome);
    if (!nome.startsWith('SIPAG-EDI-S-')) assert.equal(r.vendas_adquirentes.length, 0);
    edis.push(...r.vendas_adquirentes);
  }
  const carregar = async (prefixo: string) => {
    const nome = arquivos.find(n => n.startsWith(prefixo))!;
    return (await parseSipagExtratoCsv(nome,path.join(dir,nome),nome)).vendas_adquirentes;
  };
  const autorizacoes = await carregar('relatorio_transacoes_autorizadas');
  const detalhadas = await carregar('vendas_realizadas_relatorio_detalhado');
  const pix = await carregar('relatorio_vendas_pix');
  assert.equal(edis.length,2807);assert.equal(autorizacoes.length,2933);
  for (const lotes of [[edis,autorizacoes,detalhadas,pix],[autorizacoes,pix,detalhadas,edis]]) {
    let rows: LinhaSipag[] = [];
    for (const lote of lotes) rows=aplicar(rows,lote);
    assert.equal(rows.length,2969);
    for (const lote of [...lotes].reverse()) rows=aplicar(rows,lote.map(v=>({...v,id:'again-'+v.id,importacao_id:'again-'+v.importacao_id})));
    assert.equal(rows.length,2969);
    assert.equal(rows.filter(r=>r.dados.status_transacao==='NEGADO').length,105);
    assert.equal(rows.filter(r=>r.dados.modalidade==='PIX').length,36);
    assert.equal(rows.filter(r=>r.dados.modalidade==='VOUCHER' && r.dados.status_transacao==='AUTORIZADO').length,62);
    const porChave = new Map(rows.map(r => [sipagChaveComplementar(r.dados), r.dados]));
    for (const detail of detalhadas) {
      const v=porChave.get(sipagChaveComplementar(detail))!;
      assert.ok((v.dados_json as any).sipag_fontes_v197.EDI_2_0);
      assert.equal(Number(v.valor_bruto),Number(detail.valor_bruto));
      assert.ok(Math.abs(Number(v.valor_taxa)-Number(detail.valor_taxa))<0.03);
    }
  }
});
