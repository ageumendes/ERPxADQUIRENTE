import fs from 'node:fs/promises';
import { simularCorrecao,resumoPlano,aplicarCorrecao,desfazerCorrecao } from '../services/correcao-vendas.js';
import { closePool } from '../database/pool.js';
const args=process.argv.slice(2),get=(k:string,defaultValue='')=>{const i=args.indexOf(k);return i>=0?args[i+1]:defaultValue;};
async function main(){
 // Same basic dotenv convention as server.ts; never execute shell content.
 for (const envPath of ['.env', 'backend/.env']) { try { const env=await fs.readFile(envPath,'utf8'); for(const line of env.split(/\r?\n/)) {
   const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
   if(m && process.env[m[1]]===undefined) process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');
 } break; } catch(e:any) { if(e.code!=='ENOENT')throw e; } }
 const action=args[0];
 if(action==='simular'){
  const fase=get('--fase','duplicidades');if(fase!=='duplicidades'&&fase!=='vouchers')throw new Error('Fase inválida.');
  const p=resumoPlano(await simularCorrecao(fase,Number(get('--limite','200'))));
  const out=get('--saida',`plano-${fase}.json`);await fs.writeFile(out,JSON.stringify(p,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({arquivo:out,fase,grupos:p.grupos.length,bloqueados:p.bloqueados.length,remocoes:p.remocoes,atualizacoes:p.atualizacoes},null,2));
 }else if(action==='aplicar'){
  const path=get('--plano');if(!path)throw new Error('Informe --plano.');console.log(JSON.stringify(await aplicarCorrecao(JSON.parse(await fs.readFile(path,'utf8'))),null,2));
 }else if(action==='desfazer'){
  const id=get('--execucao');if(!id)throw new Error('Informe --execucao.');console.log(JSON.stringify(await desfazerCorrecao(id),null,2));
 }else throw new Error('Use simular --fase duplicidades|vouchers --saida plano.json; aplicar --plano plano.json; desfazer --execucao UUID.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(closePool);
