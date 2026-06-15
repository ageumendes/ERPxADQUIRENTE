import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dirs = [
  'storage/importacoes/entrada',
  'storage/importacoes/processando',
  'storage/importacoes/processados',
  'storage/importacoes/erro',
  'storage/importacoes/desconhecidos',
  'storage/db',
  'storage/logs',
  'storage/keys',
  'storage/remote-edi/cielo/pulled',
  'storage/remote-edi/sipag/pulled',
  'storage/remote-edi/sicredi/pulled'
];
const tabelas = [
  'storage/db/importacoes.json',
  'storage/db/vendas-erp.json',
  'storage/db/vendas-adquirentes.json',
  'storage/db/vendas-interdata.json',
  'storage/db/conciliacoes.json',
  'storage/db/conversoes.json'
];
for (const dir of dirs) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  const keep = path.join(root, dir, '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
}
for (const arquivo of tabelas) {
  const caminho = path.join(root, arquivo);
  if (!fs.existsSync(caminho)) fs.writeFileSync(caminho, '[]\n');
}
console.log('Pastas, tabelas locais e estrutura SFTP do ERPxADQUIRENTE preparadas com sucesso.');
