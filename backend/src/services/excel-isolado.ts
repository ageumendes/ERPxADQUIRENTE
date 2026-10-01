import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ResultadoExcelIsolado = { matriz: unknown[][]; quantidade_registros: number };

export async function lerExcelIsolado(caminhoArquivo: string, apenasAmostra = false): Promise<ResultadoExcelIsolado> {
  const timeoutMs = Math.min(Math.max(Number(process.env.PARSER_TIMEOUT_MS || 30_000), 1_000), 120_000);
  const memoriaMb = Math.min(Math.max(Number(process.env.PARSER_MEMORY_MB || 256), 64), 512);
  const maxLinhas = Math.min(Math.max(Number(process.env.PARSER_MAX_ROWS || 200_000), 100), 1_000_000);
  const maxCelulas = Math.min(Math.max(Number(process.env.PARSER_MAX_CELLS || 2_000_000), 1_000), 10_000_000);
  const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), '../workers/excel-worker.cjs');

  return new Promise((resolve, reject) => {
    const filho = fork(worker, [caminhoArquivo], {
      execArgv: [`--max-old-space-size=${memoriaMb}`],
      env: {
        ...process.env,
        PARSER_MAX_ROWS: String(maxLinhas),
        PARSER_MAX_CELLS: String(maxCelulas),
        PARSER_SAMPLE_ROWS: apenasAmostra ? '100' : '0',
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let erroTecnico = '';
    filho.stderr?.on('data', (chunk) => { erroTecnico = `${erroTecnico}${String(chunk)}`.slice(-2_000); });
    const timer = setTimeout(() => {
      filho.kill('SIGKILL');
      reject(new Error(`O parser Excel excedeu o limite de ${timeoutMs} ms.`));
    }, timeoutMs);
    filho.once('message', (mensagem: any) => {
      clearTimeout(timer);
      filho.kill();
      if (!mensagem?.sucesso) reject(new Error(mensagem?.erro || 'Falha ao processar a planilha em ambiente isolado.'));
      else resolve({ matriz: mensagem.matriz || [], quantidade_registros: Number(mensagem.quantidade_registros || 0) });
    });
    filho.once('error', (error) => { clearTimeout(timer); reject(error); });
    filho.once('exit', (codigo) => {
      if (codigo && codigo !== 0) {
        clearTimeout(timer);
        reject(new Error(`O parser Excel isolado foi encerrado com código ${codigo}.${erroTecnico ? ' Consulte o log técnico.' : ''}`));
      }
    });
  });
}
