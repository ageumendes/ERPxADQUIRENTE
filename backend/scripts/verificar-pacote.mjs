import { access, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await access(path.join(root,'dist/server.js'));
await access(path.join(root,'dist/workers/excel-worker.cjs'));
const { lerExcelIsolado } = await import('../dist/services/excel-isolado.js');
const XLSX=createRequire(import.meta.url)('xlsx');
const dir=await mkdtemp(path.join(os.tmpdir(),'erp-release-'));
try {
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['NSU'],['000123']]),'Teste');
  const file=path.join(dir,'teste.xlsx');XLSX.writeFile(wb,file);
  const parsed=await lerExcelIsolado(file);
  if(parsed.matriz[1]?.[0]!=='000123') throw new Error('Parser Excel não preservou o identificador.');
  console.log('Pacote compilado OK: worker Excel executado e identificador preservado.');
} finally {await rm(dir,{recursive:true,force:true});}
