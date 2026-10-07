import ts from 'typescript';
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function files(dir) {
  const rows=[];
  for(const item of await readdir(dir,{withFileTypes:true})) {
    const p=path.join(dir,item.name);
    if(item.isDirectory()) rows.push(...await files(p)); else if(item.name.endsWith('.ts')) rows.push(p);
  }
  return rows;
}
const errors=[];
for(const file of await files(path.join(root,'src'))) {
  const ast=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
  function visit(node) {
    const spec=(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))?node.moduleSpecifier:
      ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword?node.arguments[0]:null;
    if(spec&&ts.isStringLiteral(spec)&&spec.text.startsWith('.')) {
      const target=path.resolve(path.dirname(file),spec.text.replace(/\.js$/,'.ts'));
      errors.push(access(target).catch(()=>{throw new Error(`${path.relative(root,file)}: import ausente ${spec.text}`);}));
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
}
await Promise.all(errors);
await access(path.join(root,'src/workers/excel-worker.cjs'));
console.log('Smoke test ESM: imports locais e worker presentes.');
