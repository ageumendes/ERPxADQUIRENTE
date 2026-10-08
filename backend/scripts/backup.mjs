import '../dist/config/env.js';
import { APP_VERSION } from '../dist/version.js';
import { Pool } from 'pg';
import { mkdir, cp, copyFile, stat, chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
if(!process.env.DATABASE_URL || !process.env.ENV_FILE || !process.env.STORAGE_DIR) throw new Error('Defina DATABASE_URL, ENV_FILE e STORAGE_DIR.');
process.umask(0o077);
const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
const lock=await pool.connect();
try {
const acquired=await lock.query('SELECT pg_try_advisory_lock(242,0) AS obtido');
if(!acquired.rows[0]?.obtido) throw new Error('Pare o aplicativo antes do backup: banco e storage precisam de cópia consistente.');
const url=new URL(process.env.DATABASE_URL);
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const destination=path.resolve(process.argv[2] || '/var/backups/erpxadquirente',stamp);
await mkdir(destination,{recursive:true,mode:0o700});
const dump=path.join(destination,'database.dump');
// Preserva sslmode/opções da URL sem publicar a senha nos argumentos do processo.
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGCONNECT_TIMEOUT:'10'};
const opcoesCliente={sslmode:'PGSSLMODE',sslrootcert:'PGSSLROOTCERT',sslcert:'PGSSLCERT',sslkey:'PGSSLKEY',sslcrl:'PGSSLCRL',options:'PGOPTIONS',application_name:'PGAPPNAME',connect_timeout:'PGCONNECT_TIMEOUT'};
for(const [chave,valor] of url.searchParams){
  if(chave==='schema')continue;
  if(!(chave in opcoesCliente))throw new Error('Opção PostgreSQL não suportada pelo backup: '+chave);
  env[opcoesCliente[chave]]=valor;
}
await new Promise((resolve,reject)=>{
  const child=spawn('pg_dump',['--format=custom','--file',dump],{env,stdio:['ignore','ignore','pipe']});
  child.stderr.resume();
  child.once('error',reject);
  child.once('exit',code=>code===0?resolve():reject(new Error(`pg_dump falhou (código ${code}); verifique conexão e versão do cliente.`)));
});
await copyFile(process.env.ENV_FILE,path.join(destination,'backend.env'));
await chmod(path.join(destination,'backend.env'),0o600);
await cp(process.env.STORAGE_DIR,path.join(destination,'storage'),{recursive:true,dereference:false});
const bytes=(await stat(dump)).size;
const digest=createHash('sha256');
for await (const chunk of createReadStream(dump)) digest.update(chunk);
const hash=digest.digest('hex');
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({criado_em:new Date().toISOString(),banco:url.pathname.slice(1),dump_bytes:bytes,dump_sha256:hash,versao:APP_VERSION},null,2));
console.log(`Backup concluído: ${destination}. Contém credenciais; mantenha acesso restrito e uma cópia externa protegida.`);

} finally {await lock.query('SELECT pg_advisory_unlock(242,0)').catch(()=>{});lock.release();await pool.end();}
