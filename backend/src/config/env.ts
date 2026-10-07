import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Executado antes dos módulos que calculam opções de segurança a partir do ambiente.
const diretorio = path.dirname(fileURLToPath(import.meta.url));
for (const candidato of [process.env.ENV_FILE, path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'), path.resolve(diretorio, '../../.env')].filter(Boolean) as string[]) {
  if (!fs.existsSync(candidato)) continue;
  const valores = process.env;
  for (const original of fs.readFileSync(candidato, 'utf8').split(/\r?\n/)) {
    const linha = original.trim();
    const indice = linha.indexOf('=');
    if (!linha || linha.startsWith('#') || indice <= 0) continue;
    const chave = linha.slice(0, indice).trim();
    let valor = linha.slice(indice + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
    if (valores[chave] === undefined) valores[chave] = valor;
  }
  break;
}
