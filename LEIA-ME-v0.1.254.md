# ERPxADQUIRENTE v0.1.254

A conciliação por período usa lotes de sete dias inclusivos, do mais recente ao mais antigo. O dia inicial de um lote é também o dia final do seguinte: 25/09–01/10, 19/09–25/09, 13/09–19/09. O último lote respeita a data inicial solicitada. Itens já conciliados não são novamente consumidos.

O botão padrão e o processamento após importação/conversão continuam usando os últimos sete dias, contando o dia atual no calendário America/La_Paz. O agrupamento SIPAG segue o período ERP de cada lote.

A tela acompanha os lotes sequencialmente, permite pausar após terminar o lote atual e retomar. Mantenha a tela aberta: o progresso de retomada não é persistido após recarregar ou fechar a página. Cada lote tem uma requisição própria; períodos longos não ficam em uma única requisição do navegador.

O backend registra início, conclusão ou falha, número do lote, período ERP, quantidade conciliada e duração. Exemplo:

    [conciliacao:lote] iniciando lote=1/46 ERP=2026-09-25 a 2026-10-01
    [conciliacao:lote] concluído lote=1/46 ERP=2026-09-25 a 2026-10-01 conciliados=12 tempo_ms=2345

Para proteger as fronteiras, o motor consulta também candidatos ERP nos dois dias vizinhos de cada extremo, apenas como contexto. Eles não são conciliados fora do lote. Concorrência com esses candidatos impede a confirmação automática daquele par; portanto podem permanecer itens para revisão. Sugestões históricas não são promovidas somente pelo score nos lotes protegidos. As contagens acumuladas de avaliações e ambiguidades representam ocorrências por lote; o dia compartilhado pode ser avaliado novamente.

Validação: suíte automatizada com 212 testes, 210 aprovados e dois ignorados por ausência de arquivos reais; builds backend/frontend e verificação dos imports ESM. Os testes incluem planejamento semanal, limites inclusivos e proteção de concorrência entre datas vizinhas usando PGlite. O tempo real de execução deve ser medido com os dados do DEV antes da implantação; a consulta geral da lista de conciliações não foi otimizada nesta versão.

Antes de atualizar produção, valide o período curto e um período histórico no DEV. Preserve backup do banco, storage, certificados e configurações. Não substitua os segredos existentes. Requer Node >=22.12.0 e <25.
