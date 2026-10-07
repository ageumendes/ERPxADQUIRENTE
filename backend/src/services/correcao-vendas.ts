import {chaveSemanticaCoopcerto,planejarAtualizacoesCoopcerto} from './coopcerto-upsert.js';
import { createHash, randomUUID } from 'node:crypto';
import { getPool } from '../database/pool.js';
import { chaveVenda, centavosVenda, lojaVenda, parcelasVenda, textoVenda } from './identidade-venda.js';
import { selecionarParesVoucher, capturaVoucher, economicaVoucher } from './voucher-pares.js';
import type { VendaAdquirente } from '../repositories/repositorio.js';
type Registro=Record<string,any>;
type Alteracao={id:string;antes:Registro;depois:Registro|null};
export type PlanoCorrecao={versao:1;assinatura:string;limite:number;fase:'duplicidades'|'vouchers'|'coopcerto';grupos:Registro[];bloqueados:Registro[];alteracoes:Alteracao[];conciliacoes:Alteracao[]};
const stable=(x:any):string => JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const igual=(a:any,b:any)=>stable(a)===stable(b);
function assinatura(v:Registro[],c:Registro[]){const hash=createHash('sha256');for(const r of [...v,...c].sort((a,b)=>String(a.row_id).localeCompare(String(b.row_id))))hash.update(stable(r));return hash.digest('hex');}
function finalCartao(v:Registro){const j=v.dados_json||{};const s=String(j['Nº cartão']||j.sipag_autorizacao?.['Nº cartão']||j.numero_cartao||j.cartao_mascarado||'');return /\d{4}$/.test(s)?s.slice(-4):'';}
function financeira(grupo:Registro[]):{fonte?:Registro;erro?:string}{
 const confiaveis=grupo.filter(v=>!String(v.layout_origem).includes('transacoes_autorizadas'));
 const fontes=confiaveis.length?confiaveis:grupo;
 const vals=fontes.map(v=>[centavosVenda(v.valor_taxa),centavosVenda(v.valor_liquido)]);
 if(vals.some(v=>v.includes(null)))return {erro:'VALOR_FINANCEIRO_INVALIDO'};
 if(new Set(vals.map(v=>JSON.stringify(v))).size>1)return {erro:'FONTES_FINANCEIRAS_DIVERGENTES'};
 return {fonte:fontes.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0]};
}
/** Pure planner: caller supplies physical columns and every conciliation, including suggestions. */
export function planejarCorrecao(vendas:Registro[],concs:Registro[],fase:'duplicidades'|'vouchers'|'coopcerto'='duplicidades',limite=200):PlanoCorrecao {
 if(!Number.isInteger(limite)||limite<1||limite>1000)throw new Error('Limite deve estar entre 1 e 1000 grupos.');
 const p:PlanoCorrecao={versao:1,assinatura:assinatura(vendas,concs),limite,fase,grupos:[],bloqueados:[],alteracoes:[],conciliacoes:[]};
 const byId=new Map(vendas.map(r=>[r.row_id,r]));
 const refs=new Set<string>();for(const c of concs)if(c.venda_adquirente_id)refs.add(c.venda_adquirente_id);
 for(const r of vendas)if(r.dados.vinculo_voucher_id)refs.add(r.dados.vinculo_voucher_id);
 const data=vendas.map(r=>({...r.dados,id:r.row_id,conciliacao_id:r.conciliacao_id||r.dados.conciliacao_id||''}));
 if(fase==='coopcerto') {
  const grupos=new Map<string,Registro[]>();
  for(const v of data) {
   if(v.utilidade_status==='NAO_UTIL'||v.suprimido_por_vinculo_voucher)continue;
   const key=chaveSemanticaCoopcerto(v as VendaAdquirente);if(!key)continue;
   const lista=grupos.get(key)||[];lista.push(v);grupos.set(key,lista);
  }
  for(const [chave,g] of [...grupos].sort(([a],[b])=>a.localeCompare(b))) {
   if(g.length<2)continue;
   const autorizadas=g.filter(v=>/AUTORIZ|PROCESSAD|APROVAD/.test(textoVenda(v.status_transacao))&&!/NAO AUTORIZ/.test(textoVenda(v.status_transacao)));
   const financeiras=new Set(autorizadas.map(v=>JSON.stringify([centavosVenda(v.valor_taxa),centavosVenda(v.valor_liquido)])));
   if(financeiras.size>1) {p.bloqueados.push({ids:g.map(v=>v.id),motivo:'FONTES_FINANCEIRAS_DIVERGENTES'});continue;}
   const existentes=g.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(v=>({row_id:v.id,dados:v as VendaAdquirente,referenciado:refs.has(v.id)}));
   const plano=planejarAtualizacoesCoopcerto(existentes,[existentes[0].dados]);
   if(plano.conflitos) {p.bloqueados.push({ids:g.map(v=>v.id),motivo:'IDENTIDADE_DIVERGENTE_OU_MULTIPLOS_VINCULOS'});continue;}
   if(!plano.substituidos.size||p.grupos.length>=limite)continue;
   const manter=[...plano.substituidos.values()][0];
   const atualizado=plano.updates.get(manter)||byId.get(manter)!.dados;
   p.grupos.push({chave,manter,substituir:[...plano.substituidos.keys()],status:atualizado.status_transacao,valor_bruto:atualizado.valor_bruto,valor_taxa:atualizado.valor_taxa,valor_liquido:atualizado.valor_liquido});
   if(plano.updates.has(manter))p.alteracoes.push({id:manter,antes:byId.get(manter)!,depois:atualizado});
   for(const [id,principal] of plano.substituidos)p.alteracoes.push({id,antes:byId.get(id)!,depois:{...byId.get(id)!.dados,utilidade_status:'NAO_UTIL',utilidade_motivo:'COOPCERTO_ATUALIZACAO_SUBSTITUIDA',coopcerto_substituida_por_id:principal}});
  }
 }else if(fase==='duplicidades'){
  const grupos=new Map<string,Registro[]>();
  for(const v of data){if(v.suprimido_por_vinculo_voucher===true||v.suprimido_por_vinculo_voucher==='true')continue;const k=chaveVenda(v);if(k){const g=grupos.get(k)||[];g.push(v);grupos.set(k,g);}}
  for(const [chave,g] of [...grupos].sort(([a],[b])=>a.localeCompare(b))){
   if(g.length<2)continue;
   const protegidos=g.filter(v=>v.conciliacao_id||refs.has(v.id)||v.vinculo_voucher_id);
   const fin=financeira(g),cards=new Set(g.map(finalCartao).filter(Boolean));
   const bands=new Set(g.map(v=>textoVenda(v.bandeira)).filter(Boolean));
   const reason=protegidos.length>1?'MULTIPLOS_REGISTROS_REFERENCIADOS':cards.size>1?'CARTOES_DIFERENTES':bands.size>1?'BANDEIRAS_DIFERENTES':fin.erro;
   const ids=g.map(v=>v.id).sort();
   if(reason){p.bloqueados.push({ids,motivo:reason});continue;}
   if(p.grupos.length>=limite)continue;
   const base=protegidos[0]||g.slice().sort((a,b)=>String(a.data_criacao||'').localeCompare(String(b.data_criacao||''))||a.id.localeCompare(b.id))[0];
   const source=fin.fonte!;const novo={...byId.get(base.id)!.dados};
   for(const campo of ['valor_taxa','valor_liquido','percentual_taxa','data_pagamento'])if(source[campo]!==undefined&&source[campo]!=='')novo[campo]=source[campo];
   novo.codigo_estabelecimento=lojaVenda(base);novo.parcelas=parcelasVenda(base.parcelas);
   novo.fontes_deduplicacao=[...(novo.fontes_deduplicacao||[]),...g.filter(v=>v.id!==base.id).map(v=>({id:v.id,importacao_id:v.importacao_id,layout_origem:v.layout_origem,nsu:v.nsu,codigo_autorizacao:v.codigo_autorizacao,hash_linha:v.hash_linha}))];
   delete novo.duplicidade_status;delete novo.duplicidade_grupo;
   p.grupos.push({chave,manter:base.id,remover:ids.filter(id=>id!==base.id),fonte_financeira:source.id});
   for(const v of g)p.alteracoes.push({id:v.id,antes:byId.get(v.id)!,depois:v.id===base.id?novo:null});
  }
 }else{
  const dec=selecionarParesVoucher(data.filter(capturaVoucher) as VendaAdquirente[],data.filter(v=>economicaVoucher(v as VendaAdquirente)&&!v.suprimido_por_vinculo_voucher) as VendaAdquirente[],120);
  for(const d of dec){
   if(d.status==='AMBIGUO'){p.bloqueados.push({ids:[d.captura.id,...d.candidatos],motivo:'VOUCHER_AMBIGUO'});continue;}
   if(d.status!=='VINCULADO'||!d.economica||p.grupos.length>=limite)continue;
   const a=d.captura,b=d.economica;
   const ca=concs.filter(c=>c.venda_adquirente_id===a.id),cb=concs.filter(c=>c.venda_adquirente_id===b.id);
   // Keep historical references untouched. Review any referenced capture first.
   if(ca.length||a.conciliacao_id||cb.length>1){p.bloqueados.push({ids:[a.id,b.id],motivo:'CAPTURA_COM_CONCILIACAO_OU_HISTORICO'});continue;}
   const financial={...byId.get(b.id)!.dados,registro_canonico:true,suprimido_por_vinculo_voucher:false,status_vinculo_voucher:'VINCULADO',vinculo_voucher_id:b.id,adquirente_captura:a.adquirente,
     dados_json:{...b.dados_json,fonte_captura:a.dados_json,captura_id:a.id,importacao_captura_id:a.importacao_id,nsu_captura:a.nsu,codigo_autorizacao_captura:a.codigo_autorizacao,evidencia_voucher:d.evidencia}};
   const capture={...byId.get(a.id)!.dados,registro_canonico:false,suprimido_por_vinculo_voucher:true,status_vinculo_voucher:'VINCULADO',vinculo_voucher_id:b.id,adquirente_captura:a.adquirente,
     dados_json:{...a.dados_json,adquirente_economica:b.adquirente,evidencia_voucher:d.evidencia}};
   p.grupos.push({captura:a.id,economica:b.id,evidencia:d.evidencia});
   p.alteracoes.push({id:a.id,antes:byId.get(a.id)!,depois:capture},{id:b.id,antes:byId.get(b.id)!,depois:financial});
  }
 }
 return p;
}
async function snapshot(q:{query:Function}){const v=await q.query('SELECT * FROM vendas_adquirentes ORDER BY row_id');const c=await q.query('SELECT * FROM conciliacoes ORDER BY row_id');return {v:v.rows,c:c.rows};}
export async function simularCorrecao(fase:'duplicidades'|'vouchers'|'coopcerto'='duplicidades',limite=200){
 const client=await getPool().connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const {v,c}=await snapshot(client);const p=planejarCorrecao(v,c,fase,limite);await client.query('COMMIT');return p;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export function resumoPlano(p:PlanoCorrecao){return {versao:p.versao,assinatura:p.assinatura,fase:p.fase,limite:p.limite,grupos:p.grupos,bloqueados:p.bloqueados,remocoes:p.alteracoes.filter(a=>!a.depois).length,atualizacoes:p.alteracoes.filter(a=>a.depois).length};}
export async function aplicarCorrecao(revisado:ReturnType<typeof resumoPlano>){
 const client=await getPool().connect();try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('LOCK TABLE vendas_adquirentes, conciliacoes IN SHARE ROW EXCLUSIVE MODE');
  const {v,c}=await snapshot(client);const plano=planejarCorrecao(v,c,revisado.fase,revisado.limite);
  if(!igual(resumoPlano(plano),revisado))throw new Error('Banco ou plano alterado. Gere e revise uma nova simulação.');
  if(!plano.alteracoes.length){await client.query('ROLLBACK');return {execucao:null,grupos:0};}
  await client.query(`CREATE TABLE IF NOT EXISTS correcao_vendas_auditoria (execucao text PRIMARY KEY, criado_em timestamptz DEFAULT now(), desfeito_em timestamptz, plano jsonb NOT NULL)`);
  const execucao=randomUUID();
  await client.query('INSERT INTO correcao_vendas_auditoria(execucao,plano) VALUES($1,$2::jsonb)',[execucao,JSON.stringify({...plano,conc_antes:c.filter((r:Registro)=>plano.alteracoes.some(a=>a.id===r.venda_adquirente_id))})]);
  for(const a of plano.alteracoes){
   if(a.depois)await client.query('UPDATE vendas_adquirentes SET dados=$1::jsonb, data_atualizacao=now() WHERE row_id=$2',[JSON.stringify(a.depois),a.id]);
   else await client.query('DELETE FROM vendas_adquirentes WHERE row_id=$1',[a.id]);
  }
  // Save exact post-state for optimistic undo. Audit already preserves full deleted rows.
  const atual=await client.query('SELECT * FROM vendas_adquirentes WHERE row_id=ANY($1::text[]) ORDER BY row_id',[plano.alteracoes.map(a=>a.id)]);
  await client.query("UPDATE correcao_vendas_auditoria SET plano=plano||jsonb_build_object('estado_depois',$1::jsonb) WHERE execucao=$2",[JSON.stringify(atual.rows),execucao]);
  await client.query('COMMIT');return {execucao,grupos:plano.grupos.length,removidos:plano.alteracoes.filter(a=>!a.depois).length};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function desfazerCorrecao(execucao:string){
 const client=await getPool().connect();try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query('LOCK TABLE vendas_adquirentes, conciliacoes IN SHARE ROW EXCLUSIVE MODE');
  const audit=await client.query('SELECT * FROM correcao_vendas_auditoria WHERE execucao=$1 FOR UPDATE',[execucao]);
  if(!audit.rows[0]||audit.rows[0].desfeito_em)throw new Error('Execução inexistente ou já desfeita.');
  const p=audit.rows[0].plano,ids=p.alteracoes.map((a:Alteracao)=>a.id);
  const now=await client.query('SELECT * FROM vendas_adquirentes WHERE row_id=ANY($1::text[]) ORDER BY row_id',[ids]);
  if(!igual(now.rows,p.estado_depois))throw new Error('Vendas mudaram após a correção. Desfazer bloqueado para preservar alterações posteriores.');
  const conc=await client.query('SELECT * FROM conciliacoes ORDER BY row_id');
  // Any new/changed related conciliation blocks undo, even if the sale JSON stayed the same.
  const related=(cs:Registro[])=>cs.filter(c=>ids.includes(c.venda_adquirente_id));
  if(!igual(related(conc.rows),p.conc_antes))throw new Error('Conciliações do lote mudaram; desfazer bloqueado.');
  if(p.fase==='vouchers' && related(conc.rows).some((c:Registro)=>p.grupos.some((g:Registro)=>g.captura===c.venda_adquirente_id||g.economica===c.venda_adquirente_id)))throw new Error('Vínculo voucher possui conciliação; revise antes de desfazer.');
  const incoming=await client.query("SELECT row_id FROM vendas_adquirentes WHERE dados->>'vinculo_voucher_id'=ANY($1::text[]) AND NOT(row_id=ANY($1::text[]))",[ids]);
  if(incoming.rows.length)throw new Error('Há vínculos externos ao lote. Revise antes de desfazer.');
  for(const a of p.alteracoes as Alteracao[]){const r=a.antes;
   if(a.depois)await client.query('UPDATE vendas_adquirentes SET dados=$1::jsonb,conciliacao_id=$2,data_atualizacao=$3 WHERE row_id=$4',[JSON.stringify(r.dados),r.conciliacao_id,r.data_atualizacao,a.id]);
   else await client.query('INSERT INTO vendas_adquirentes(pk,row_id,hash_linha,hash_arquivo,dados,data_criacao,data_atualizacao,conciliacao_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)',[r.pk,r.row_id,r.hash_linha,r.hash_arquivo,JSON.stringify(r.dados),r.data_criacao,r.data_atualizacao,r.conciliacao_id]);
  }
  await client.query('UPDATE correcao_vendas_auditoria SET desfeito_em=now() WHERE execucao=$1',[execucao]);await client.query('COMMIT');return {execucao,desfeito:true};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
