import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['dist', '.test-dist/src']) {
  await mkdir(path.join(root, dir, 'workers'), { recursive:true });
  await cp(path.join(root,'src/workers/excel-worker.cjs'), path.join(root,dir,'workers/excel-worker.cjs'));
}
