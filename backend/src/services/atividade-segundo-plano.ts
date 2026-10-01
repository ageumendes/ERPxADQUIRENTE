export type TipoAtividadeSegundoPlano = 'conversoes' | 'conciliacao';

const atividades = new Map<TipoAtividadeSegundoPlano, number>([
  ['conversoes', 0],
  ['conciliacao', 0],
]);

export function obterAtividadesSegundoPlano() {
  const conversoes = (atividades.get('conversoes') || 0) > 0;
  const conciliacao = (atividades.get('conciliacao') || 0) > 0;
  return {
    conversoes,
    conciliacao,
    ativa: conversoes || conciliacao,
    etapa: conversoes ? 'Aplicando conversões' : conciliacao ? 'Executando conciliação' : '',
  };
}

export async function executarComAtividadeSegundoPlano<T>(tipo: TipoAtividadeSegundoPlano, tarefa: () => Promise<T>): Promise<T> {
  atividades.set(tipo, (atividades.get(tipo) || 0) + 1);
  try {
    return await tarefa();
  } finally {
    atividades.set(tipo, Math.max(0, (atividades.get(tipo) || 1) - 1));
  }
}
