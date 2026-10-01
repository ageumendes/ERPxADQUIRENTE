/** Data e hora comerciais do PIX no fuso usado pelas lojas (Bolívia/Rondônia). */
export function dataHoraPixLaPaz(horario?: string | null): { data_venda: string | null; hora_venda: string | null } {
  if (!horario) return { data_venda: null, hora_venda: null };
  const texto = String(horario);
  // Os arquivos atuais fornecem UTC (Z). Um offset explícito também representa um instante.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(texto)) {
    return { data_venda: null, hora_venda: null };
  }
  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) return { data_venda: null, hora_venda: null };
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(data);
  const obter = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value || '';
  return { data_venda: `${obter('year')}-${obter('month')}-${obter('day')}`, hora_venda: `${obter('hour')}:${obter('minute')}:${obter('second')}` };
}
