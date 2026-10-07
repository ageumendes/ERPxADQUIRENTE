import fs from 'node:fs/promises';
import path from 'node:path';

export async function listarArquivosRecursivos(diretorio: string): Promise<string[]> {
  const arquivos: string[] = [];
  for (const item of await fs.readdir(diretorio, { withFileTypes: true }).catch(() => [])) {
    const alvo = path.join(diretorio, item.name);
    if (item.isDirectory()) arquivos.push(...await listarArquivosRecursivos(alvo));
    else if (item.isFile()) arquivos.push(alvo); // Não segue symlinks.
  }
  return arquivos.sort();
}

export function caminhoDentroPastas(caminho: string, pastas: string[]) {
  return pastas.some(pasta => {
    const relativo = path.relative(path.resolve(pasta), path.resolve(caminho));
    return relativo !== '' && relativo !== '..' && !relativo.startsWith('..' + path.sep) && !path.isAbsolute(relativo);
  });
}
