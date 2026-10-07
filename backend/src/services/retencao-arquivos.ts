import fs from 'node:fs/promises';
import path from 'node:path';
import { processadosDir, erroDir, logsDir } from '../paths.js';

async function removerAntigos(diretorio: string, dias: number, agora = Date.now()): Promise<number> {
  if (dias <= 0) return 0;
  const limite = agora - dias * 86_400_000;
  let removidos = 0;
  for (const item of await fs.readdir(diretorio, { withFileTypes: true }).catch(() => [])) {
    const alvo = path.join(diretorio, item.name);
    if (item.isDirectory()) { removidos += await removerAntigos(alvo, dias, agora); continue; }
    const stat = await fs.stat(alvo).catch(() => null);
    if (stat?.isFile() && stat.mtimeMs < limite) { await fs.unlink(alvo); removidos += 1; }
  }
  return removidos;
}

export async function executarRetencaoArquivos() {
  const processadosDias = Math.max(0, Number(process.env.RETENCAO_PROCESSADOS_DIAS || 0));
  const errosDias = Math.max(0, Number(process.env.RETENCAO_ERROS_DIAS || 0));
  const logsDias = Math.max(0, Number(process.env.RETENCAO_LOGS_DIAS || 30));
  const [processados, erros, logs] = await Promise.all([
    removerAntigos(processadosDir, processadosDias),
    removerAntigos(erroDir, errosDias),
    removerAntigos(logsDir, logsDias),
  ]);
  if (processados + erros + logs > 0) console.log(`[retencao] Removidos: processados=${processados}, erros=${erros}, logs=${logs}`);
  return { processados, erros, logs };
}

export function agendarRetencaoArquivos() {
  void executarRetencaoArquivos().catch((error) => console.error('[retencao] Falha na limpeza programada:', error));
  const timer = setInterval(() => void executarRetencaoArquivos().catch((error) => console.error('[retencao] Falha na limpeza programada:', error)), 24 * 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
