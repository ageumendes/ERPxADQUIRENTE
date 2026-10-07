/** Recupera o líquido informado no original, sem calcular nem alterar bruto/hashes/vínculos. */
export async function preencherValorLiquidoErp(pool: {query: (sql:string) => Promise<unknown>}) {
  await pool.query(`WITH originais AS (
    SELECT pk, (SELECT value FROM jsonb_each_text(
      CASE WHEN jsonb_typeof(dados->'dados_originais')='object' THEN dados->'dados_originais' ELSE '{}'::jsonb END
    ) WHERE TRANSLATE(UPPER(TRIM(key)), 'Í', 'I') IN ('VLR. LIQUIDO','VLR LIQUIDO','VALOR LIQUIDO','VALOR_LIQUIDO','NET_AMOUNT')
      AND TRIM(value)<>'' ORDER BY key LIMIT 1) AS liquido
    FROM vendas_interdata WHERE COALESCE(TRIM(dados->>'valor_liquido'),'')=''
  ) UPDATE vendas_interdata v SET dados=jsonb_set(v.dados,'{valor_liquido}',to_jsonb(o.liquido),true)
    FROM originais o WHERE v.pk=o.pk AND o.liquido IS NOT NULL`);
}
