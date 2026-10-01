# Versão 0.1.116 — correção do executor de conversões

## Defeito corrigido

As tabelas operacionais do PostgreSQL armazenam os campos de negócio dentro do
JSONB `dados`. Assim, `adquirente`, `modalidade`, `bandeira` e campos semelhantes
não são colunas SQL físicas.

O executor foi alterado para localizar e atualizar essas propriedades diretamente
no JSONB, usando o mesmo critério normalizado (`TRIM` e caixa alta) para contagem e
gravação.

## Garantias

- regras específicas respeitam `adquirente_aplicacao`;
- regras vazias ou `TODAS` continuam globais;
- o valor anterior é preservado em `*_original` quando previsto no catálogo;
- registros já convertidos contam como encontrados, mas não como alterados;
- as alterações de cada tabela são transacionais;
- tabelas inteiras não são mais carregadas e regravadas para aplicar regras.

## Consulta correta para conferência da VR

```sql
SELECT
  dados->>'adquirente' AS adquirente,
  dados->>'modalidade' AS modalidade,
  COUNT(*) AS quantidade
FROM vendas_adquirentes
WHERE UPPER(COALESCE(dados->>'adquirente', '')) LIKE '%VR%'
   OR UPPER(COALESCE(dados->>'modalidade', '')) LIKE 'VR%'
GROUP BY dados->>'adquirente', dados->>'modalidade'
ORDER BY adquirente, modalidade;
```
