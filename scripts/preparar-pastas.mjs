import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dirs = [
  'storage/importacoes/entrada',
  'storage/importacoes/processando',
  'storage/importacoes/processados',
  'storage/importacoes/erro',
  'storage/importacoes/desconhecidos',
  'storage/logs',
  'storage/keys',
  'storage/remote-edi/cielo/pulled',
  'storage/remote-edi/sipag/pulled',
  'storage/remote-edi/sicredi/pulled'
];

for (const dir of dirs) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  const keep = path.join(root, dir, '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
}
console.log('Pastas operacionais e estrutura SFTP do ERPxADQUIRENTE preparadas com sucesso.');
