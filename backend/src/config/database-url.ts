export function urlPostgresParaCliente(url: string): string {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('URL PostgreSQL inválida.');
  parsed.searchParams.delete('schema');
  return parsed.toString();
}
