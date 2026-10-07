import {parcelaSipagSemAgrupamento} from './conciliacao-hibrida.js';
export type PixTransaction = {
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<unknown>;
  $queryRawUnsafe(sql: string, ...params: unknown[]): Promise<unknown[]>;
};

// Os valores originais não são alterados: estes campos descrevem apenas a relação entre fontes.
export const PIX_E2E_SQL = (alias: string) => `TRIM(COALESCE(NULLIF(${alias}.dados->'dados_json'->>'end_to_end_id',''),NULLIF(${alias}.dados->'dados_json'->>'endToEndId',''),NULLIF(${alias}.dados->>'end_to_end_id',''),${alias}.dados->>'nsu',''))`;
export const PIX_FINANCEIRO_SQL = (alias = '') => `UPPER(COALESCE(${alias ? alias + '.' : ''}dados->>'pix_redundante','NAO')) <> 'SIM'`;

export async function sincronizarVinculosPixSipagSicoobTx(tx: PixTransaction) {
  // Mesma ordem de aquisição nos caminhos manual, automático e confirmação/desfazimento.
  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(242, 1)');
  await tx.$executeRawUnsafe(`WITH base AS (
    SELECT v.row_id, v.conciliacao_id, v.dados, v.data_venda_filtro, v.estabelecimento_chave,
           UPPER(TRIM(COALESCE(v.dados->>'adquirente',''))) AS adquirente,
           ${PIX_E2E_SQL('v')} AS e2e
      FROM vendas_adquirentes v
     WHERE v.registro_nao_aplicavel = FALSE AND UPPER(TRIM(COALESCE(v.dados->>'modalidade','')))='PIX'
       AND UPPER(TRIM(COALESCE(v.dados->>'adquirente',''))) IN ('SIPAG','SICOOB')
  ), grupos AS (
    SELECT e2e, COUNT(*) AS total, COUNT(*) FILTER (WHERE conciliacao_id IS NOT NULL) AS vinculados,
           COUNT(DISTINCT adquirente) AS fontes,
           COUNT(DISTINCT CASE WHEN REPLACE(COALESCE(dados->>'valor_bruto',''),',','.') ~ '^-?[0-9]+([.][0-9]+)?$' THEN ROUND(REPLACE(dados->>'valor_bruto',',','.')::numeric * 100)::text ELSE COALESCE(dados->>'valor_bruto','') END) AS valores,
           COUNT(DISTINCT data_venda_filtro) AS datas,
           COUNT(DISTINCT estabelecimento_chave) AS lojas
      FROM base WHERE e2e<>'' GROUP BY e2e HAVING COUNT(DISTINCT adquirente)=2
  ), ordenados AS (
    SELECT b.*, g.total, g.vinculados, g.valores, g.datas, g.lojas,
           ROW_NUMBER() OVER (PARTITION BY b.e2e ORDER BY
             CASE WHEN b.conciliacao_id IS NOT NULL THEN 0 ELSE 1 END,
             CASE WHEN b.adquirente='SICOOB' THEN 0 ELSE 1 END, b.row_id) AS ordem,
           FIRST_VALUE(b.adquirente) OVER (PARTITION BY b.e2e ORDER BY
             CASE WHEN b.conciliacao_id IS NOT NULL THEN 0 ELSE 1 END,
             CASE WHEN b.adquirente='SICOOB' THEN 0 ELSE 1 END, b.row_id) AS primaria
      FROM base b JOIN grupos g ON g.e2e=b.e2e
  ), patches AS (
    SELECT o.row_id, jsonb_build_object(
      'pix_operacao_compartilhada','SIM', 'pix_end_to_end_id',o.e2e,
      'pix_fonte_par',CASE WHEN o.adquirente='SIPAG' THEN 'SICOOB' ELSE 'SIPAG' END,
      'pix_registro_par_id',(SELECT MIN(b.row_id) FROM base b WHERE b.e2e=o.e2e AND b.adquirente<>o.adquirente),
      'pix_vinculo_criterio','END_TO_END_ID_EXATO', 'pix_fonte_primaria',o.primaria,
      'pix_redundante',CASE WHEN o.ordem=1 THEN 'NAO' ELSE 'SIM' END,
      'pix_vinculo_conflito',CASE WHEN o.vinculados>1 THEN 'AMBOS_CONCILIADOS'
                                WHEN o.total>2 THEN 'MULTIPLOS_REGISTROS'
                                WHEN o.valores>1 OR o.datas>1 OR o.lojas>1 THEN 'DIVERGENCIA_ENTRE_FONTES' ELSE '' END
    ) AS patch FROM ordenados o
  ) UPDATE vendas_adquirentes v SET dados=v.dados || p.patch, data_atualizacao=NOW()
      FROM patches p WHERE v.row_id=p.row_id AND NOT (v.dados @> p.patch)`);

  // Um par removido/alterado não deve deixar a fonte sobrevivente inelegível.
  await tx.$executeRawUnsafe(`UPDATE vendas_adquirentes v SET
    dados=v.dados - ARRAY['pix_operacao_compartilhada','pix_end_to_end_id','pix_fonte_par',
      'pix_registro_par_id','pix_vinculo_criterio','pix_fonte_primaria','pix_redundante','pix_vinculo_conflito'],
    data_atualizacao=NOW()
    WHERE v.dados ? 'pix_operacao_compartilhada' AND NOT EXISTS (
      SELECT 1 FROM vendas_adquirentes p
       WHERE v.registro_nao_aplicavel = FALSE AND p.registro_nao_aplicavel = FALSE AND UPPER(TRIM(COALESCE(v.dados->>'modalidade','')))='PIX'
         AND UPPER(TRIM(COALESCE(p.dados->>'modalidade','')))='PIX'
         AND UPPER(TRIM(COALESCE(v.dados->>'adquirente',''))) IN ('SIPAG','SICOOB')
         AND UPPER(TRIM(COALESCE(p.dados->>'adquirente',''))) IN ('SIPAG','SICOOB')
         AND UPPER(TRIM(p.dados->>'adquirente'))<>UPPER(TRIM(v.dados->>'adquirente'))
         AND ${PIX_E2E_SQL('v')}<>'' AND ${PIX_E2E_SQL('p')}=${PIX_E2E_SQL('v')}
    )`);
}

export function validarElegibilidadeConciliacao(dados: Record<string, unknown>, lado: 'ERP' | 'ADQUIRENTE') {
  const upper = (valor: unknown) => String(valor ?? '').trim().toUpperCase();
  const naoAplica = (valor: unknown) => upper(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '') === 'NAOAPLICA';
  if (['codigo_estabelecimento','cnpj_estabelecimento','pagador_cnpj','pagador_documento'].some(c => naoAplica(dados[c]))) throw new Error('Conciliação bloqueada: registro marcado como NÃO APLICA.');
  if ((dados.revisao_coopcerto as { status?: string } | undefined)?.status === 'PENDENTE')
    throw new Error('Conciliação bloqueada: atualização COOPCERTO exige revisão financeira.');
  if (upper(dados.duplicidade_status) === 'DUPLICADO_PROVAVEL' || upper(dados.utilidade_status) === 'NAO_UTIL') throw new Error('Conciliação bloqueada: registro duplicado ou sem utilidade financeira.');
  if (lado === 'ERP' && (dados.agrupamento_erp_id || dados.agrupamento_inativo)) throw new Error('Parcela reservada para agrupamento ou grupo inativo; use a venda consolidada.');
  if (lado === 'ADQUIRENTE') {
    if (upper(dados.status_transacao) !== 'AUTORIZADO') throw new Error('Conciliação bloqueada: a transação da adquirente deve estar autorizada.');
    if (upper(dados.suprimido_por_vinculo_voucher) === 'TRUE') throw new Error('Conciliação bloqueada: captura complementar de voucher.');
    if (upper(dados.pix_redundante) === 'SIM' || upper(dados.pix_vinculo_conflito)) throw new Error('Conciliação bloqueada: PIX complementar ou com conflito entre fontes.');
  }
}

export function validarParConciliacao(adq: Record<string, unknown>, erp: Record<string, unknown>, naoAplicaAdq = false, naoAplicaErp = false) {
  if(parcelaSipagSemAgrupamento(adq,erp)) throw new Error('Crédito parcelado SIPAG exige agrupamento ERP completo; parcela isolada bloqueada.');
  validarElegibilidadeConciliacao(adq, 'ADQUIRENTE');
  validarElegibilidadeConciliacao(erp, 'ERP');
  if (naoAplicaAdq || naoAplicaErp) throw new Error('Conciliação bloqueada: registro NÃO APLICA.');
  const normalizar = (valor: unknown) => String(valor ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const a = normalizar(adq.codigo_estabelecimento || adq.cnpj_estabelecimento);
  const e = normalizar(erp.cnpj_estabelecimento || erp.codigo_estabelecimento);
  if (!a || !e || a !== e) throw new Error('Conciliação bloqueada: estabelecimentos devem existir e ser idênticos.');
}
