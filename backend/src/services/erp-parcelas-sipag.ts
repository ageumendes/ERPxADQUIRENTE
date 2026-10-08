import {createHash} from 'node:crypto';
import {normalizarNsu, normalizarTexto, normalizarModalidade, normalizarParcelas} from './conciliacao-hibrida.js';

type Registro = Record<string, any>;
type Tx = {$queryRawUnsafe:(sql:string,...args:any[])=>Promise<any>; $executeRawUnsafe:(sql:string,...args:any[])=>Promise<any>};
type SqlNaoAplica = (alias:string)=>string;
export const ORIGEM_GRUPO_SIPAG='AGRUPAMENTO_PARCELAS_SIPAG';
const normalizarDataCanonica=(v:unknown)=>{const s=String(v??'').trim();const iso=s.match(/^(\d{4}-\d{2}-\d{2})/);const br=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);return iso?iso[1]:br?`${br[3]}-${br[2]}-${br[1]}`:'';};
const texto=(v:unknown)=>normalizarTexto(v);
const loja=(v:Registro)=>texto(v.adquirente ? v.codigo_estabelecimento||v.cnpj_estabelecimento : v.cnpj_estabelecimento||v.codigo_estabelecimento);
const parcela=(v:unknown)=>String(v??'').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
export function centavosParcela(v:unknown):number|null {
  let s=String(v??'').trim().replace(/^R\$\s*/,'').replace(/\s/g,'');
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  if(!/^\d+(\.\d+)?$/.test(s))return null;
  const n=Number(s);return Number.isSafeInteger(Math.round(n*100))?Math.round(n*100):null;
}
function liquidoGrupo(itens:Registro[]) {
  const valores=itens.map(v=>String(v.valor_liquido??'').trim().replace(/^R\$\s*/,'').replace(/\s/g,'')).map(s=>s.includes(',')?s.replace(/\./g,'').replace(',','.'):s);
  if(!valores.every(v=>/^\d+(\.\d{1,12})?$/.test(v)))return '';
  const casas=Math.max(2,...valores.map(v=>(v.split('.')[1]||'').length));
  const soma=valores.reduce((total,v)=>{const [i,d='']=v.split('.');return total+BigInt(i+d.padEnd(casas,'0'));},0n);
  const texto=soma.toString().padStart(casas+1,'0');return texto.slice(0,-casas)+'.'+texto.slice(-casas);
}
const assinatura=(v:Registro)=>JSON.stringify([v.id,loja(v),normalizarDataCanonica(v.data_venda),normalizarNsu(v.nsu),texto(v.id_venda_erp),normalizarModalidade(v.tipo_produto||v.modalidade),texto(v.bandeira),String(v.hora_venda||''),String(v.parcelas||''),String(v.valor_bruto||''),String(v.valor_liquido||''),v.hash_linha]);
function elegivel(v:Registro) {
  return !v._nao_aplica && !v.conciliacao_id && texto(v.duplicidade_status)!=='DUPLICADO_PROVAVEL'
    && texto(v.utilidade_status)!=='NAO_UTIL'
    && (texto(v.status_conciliacao)!=='CONCILIADO'||Boolean(v.agrupamento_erp_id));
}
export function planejarAgrupamentosSipag(erps:Registro[], adquirentes:Registro[]) {
  // Índice em memória: evita percorrer todas as adquirentes para cada venda ERP.
  const chaveAdq=(v:Registro,total:number,bruto:number)=>JSON.stringify([loja(v),normalizarDataCanonica(v.data_venda),normalizarNsu(v.nsu),texto(v.bandeira),total,bruto]);
  const indice=new Map<string,Registro[]>();
  for(const a of adquirentes) {
    if(texto(a.adquirente)!=='SIPAG'||a._nao_aplica||texto(a.status_transacao)!=='AUTORIZADO'||texto(a.duplicidade_status)==='DUPLICADO_PROVAVEL'||texto(a.utilidade_status)==='NAO_UTIL'||a.suprimido_por_vinculo_voucher||normalizarModalidade(a.modalidade)!=='CREDITO')continue;
    const bruto=centavosParcela(a.valor_bruto);if(bruto===null)continue;
    const total=normalizarParcelas(a.parcelas);if(total===null)continue;
    const k=chaveAdq(a,total,bruto);const lista=indice.get(k)||[];lista.push(a);indice.set(k,lista);
  }
  const buckets=new Map<string,Registro[]>();
  for(const v of erps) {
    if(v.origem_erp===ORIGEM_GRUPO_SIPAG)continue;
    const p=parcela(v.parcelas), venda=texto(v.id_venda_erp), nsu=normalizarNsu(v.nsu), data=normalizarDataCanonica(v.data_venda);
    if(!p||Number(p[2])<2||Number(p[2])>99||!venda||!nsu||!loja(v)||!data||normalizarModalidade(v.tipo_produto)!=='CREDITO'||!texto(v.bandeira))continue;
    // Total, horário e bandeira são validados dentro da venda, não separam grupos incompletos.
    const k=JSON.stringify([loja(v),venda,nsu,data]);const lista=buckets.get(k)||[];lista.push(v);buckets.set(k,lista);
  }
  const planos:Array<{id:string;dados:Registro;itens:Registro[];adquirente_id:string}>=[];
  for(const lista of buckets.values()) {
    const ordenada=[...lista].sort((a,b)=>Number(parcela(a.parcelas)![1])-Number(parcela(b.parcelas)![1]));
    const total=Number(parcela(ordenada[0].parcelas)![2]);
    if(lista.length!==total||!lista.every(elegivel)||!ordenada.every((v,i)=>Number(parcela(v.parcelas)![1])===i+1&&Number(parcela(v.parcelas)![2])===total))continue;
    if(new Set(lista.map(v=>JSON.stringify([texto(v.bandeira),normalizarModalidade(v.tipo_produto),String(v.hora_venda||'')]))).size!==1)continue;
    const valores=lista.map(v=>centavosParcela(v.valor_bruto));if(valores.some(v=>v===null||v<=0))continue;
    const bruto=valores.reduce<number>((s,v)=>s+(v??0),0);const base=ordenada[0];
    const correspondentes=indice.get(chaveAdq(base,total,bruto))||[];
    if(correspondentes.length!==1)continue;
    const adq=correspondentes[0];
    const id='ERP-GRUPO-SIPAG-'+createHash('sha256').update(JSON.stringify([ordenada.map(v=>v.id),adq.id])).digest('hex').slice(0,32);
    if(lista.some(v=>v.agrupamento_erp_id&&v.agrupamento_erp_id!==id))continue;
    planos.push({id,itens:ordenada,adquirente_id:adq.id,dados:{
      id,importacao_id:'AGRUPAMENTO_SIPAG',numero_linha:0,data_venda:base.data_venda,hora_venda:base.hora_venda,
      nsu:base.nsu,valor_bruto:(bruto/100).toFixed(2),valor_liquido:liquidoGrupo(lista),
      forma_pagamento:base.forma_pagamento,tipo_produto:base.tipo_produto,bandeira:base.bandeira,
      parcelas:String(total),cnpj_estabelecimento:base.cnpj_estabelecimento||base.codigo_estabelecimento,
      id_venda_erp:base.id_venda_erp,origem_erp:ORIGEM_GRUPO_SIPAG,hash_linha:id,
      agrupamento_adquirente_id:adq.id,agrupamento_inativo:false,
      agrupamento_parcelas:ordenada.map(v=>({id:v.id,parcelas:v.parcelas,valor_bruto:v.valor_bruto,valor_liquido:v.valor_liquido,assinatura:assinatura(v)})),
      dados_originais:{origem:ORIGEM_GRUPO_SIPAG,ids_parcelas:JSON.stringify(ordenada.map(v=>v.id))},
      data_criacao:new Date().toISOString(),status_conciliacao:'PENDENTE'
    }});
  }
  // Mesmo que o motor de prioridade escolhesse um dos grupos, múltiplas vendas completas ficam bloqueadas.
  const contagens=new Map<string,number>();for(const p of planos)contagens.set(p.adquirente_id,(contagens.get(p.adquirente_id)||0)+1);
  return planos.filter(p=>contagens.get(p.adquirente_id)===1);
}
async function lerFontes(tx:Tx, sqlErp:SqlNaoAplica, sqlAdq:SqlNaoAplica,nsu?:string,escopo:{dataInicial?:string;dataFinal?:string}={}) {
  // Na confirmação, carrega também vendas concorrentes com o mesmo NSU,
  // preservando a detecção de ambiguidade sem reprocessar todo o histórico.
  const filtro=(alias:string)=> {
    const limpo=`REGEXP_REPLACE(UPPER(TRIM(COALESCE(${alias}.dados->>'nsu',''))), '[^A-Z0-9]', '', 'g')`;
    return nsu===undefined?'':` AND (CASE WHEN ${limpo} ~ '^[0-9]+$' THEN COALESCE(NULLIF(LTRIM(${limpo},'0'),''),'0') ELSE ${limpo} END)=$1`;
  };
  const args=nsu===undefined?[]:[nsu];
  const periodo=(alias:string, margem=false)=> {
    if(!escopo.dataInicial||!escopo.dataFinal)return '';
    return margem ? ` AND ${alias}.data_venda_filtro BETWEEN ($${args.length+1}::date-1)::text AND ($${args.length+2}::date+1)::text` : ` AND ${alias}.data_venda_filtro BETWEEN $${args.length+1}::text AND $${args.length+2}::text`;
  };
  const argsPeriodo=escopo.dataInicial&&escopo.dataFinal?[...args,escopo.dataInicial,escopo.dataFinal]:args;
  const erps=await tx.$queryRawUnsafe(`SELECT e.row_id,e.conciliacao_id,e.dados,${sqlErp('e')} AS nao_aplica FROM vendas_interdata e WHERE COALESCE(e.dados->>'parcelas','') ~ '^[0-9]+[ ]*/[ ]*[0-9]+$'${filtro('e')}${periodo('e')}`, ...argsPeriodo);
  const adqs=await tx.$queryRawUnsafe(`SELECT a.row_id,a.conciliacao_id,a.dados,${sqlAdq('a')} AS nao_aplica FROM vendas_adquirentes a WHERE UPPER(COALESCE(a.dados->>'adquirente',''))='SIPAG'${filtro('a')}${periodo('a',true)}`, ...argsPeriodo);
  const adaptar=(r:any)=>({...r.dados,id:r.row_id,conciliacao_id:r.conciliacao_id,_nao_aplica:r.nao_aplica});
  return {erps:erps.map(adaptar),adqs:adqs.map(adaptar)};
}
export async function sincronizarAgrupamentosSipagTx(tx:Tx,sqlErp:SqlNaoAplica,sqlAdq:SqlNaoAplica,escopo:{dataInicial?:string;dataFinal?:string}={}) {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(247,1)');
  const fontes=await lerFontes(tx,sqlErp,sqlAdq,undefined,escopo);const planos=planejarAgrupamentosSipag(fontes.erps,fontes.adqs);
  const existentes=await tx.$queryRawUnsafe(`SELECT row_id,conciliacao_id,dados FROM vendas_interdata WHERE dados->>'origem_erp'=$1 AND ($2::text IS NULL OR data_venda_filtro >= $2) AND ($3::text IS NULL OR data_venda_filtro <= $3) ORDER BY row_id FOR UPDATE`,ORIGEM_GRUPO_SIPAG,escopo.dataInicial||null,escopo.dataFinal||null);
  const planosIds=new Set(planos.map(p=>p.id));
  const adqsPorId=new Map<string,Registro>(fontes.adqs.map((a:Registro)=>[a.id,a]));
  const mapa=new Map<string,any>(existentes.map((r:any)=>[r.row_id,r]));
  // Limpeza em lote: grupos já inativos não provocam duas consultas por grupo.
  const obsoletos=existentes.filter((r:any)=>!r.conciliacao_id&&!planosIds.has(r.row_id)).map((r:any)=>r.row_id);
  if(obsoletos.length){
    await tx.$executeRawUnsafe(`UPDATE vendas_interdata SET dados=dados||'{"agrupamento_inativo":true}'::jsonb WHERE row_id=ANY($1::text[]) AND COALESCE(dados->>'agrupamento_inativo','false')<>'true'`,obsoletos);
    await tx.$executeRawUnsafe(`UPDATE vendas_interdata SET dados=dados-'agrupamento_erp_id'-'conciliacao_agrupamento_id'-'status_agrupamento' WHERE dados->>'agrupamento_erp_id'=ANY($1::text[])`,obsoletos);
  }
  // Reserva as parcelas em uma consulta, mantendo a revalidação sob lock.
  const todosIds=[...new Set(planos.flatMap(p=>p.itens.map(v=>v.id)))];
  const parcelasBloqueadas=todosIds.length ? await tx.$queryRawUnsafe(`SELECT row_id,conciliacao_id,dados FROM vendas_interdata WHERE row_id=ANY($1::text[]) ORDER BY row_id FOR UPDATE`,todosIds) : [];
  const parcelasPorId=new Map<string,any>(parcelasBloqueadas.map((r:any)=>[r.row_id,r]));
  let criados=0;
  for(const p of planos) {
    const existente=mapa.get(p.id);if(existente?.conciliacao_id)continue;
    if(adqsPorId.get(p.adquirente_id)?.conciliacao_id)continue;
    const ids=p.itens.map(v=>v.id);
    const atuais=ids.map(id=>parcelasPorId.get(id)).filter(Boolean);
    if(atuais.length!==ids.length||atuais.some((r:any)=>r.conciliacao_id||assinatura({...r.dados,id:r.row_id})!==assinatura(p.itens.find(v=>v.id===r.row_id)!)))continue;
    if(existente) {
      p.dados.data_criacao=existente.dados.data_criacao;
      // Não regrava grupos intactos em cada lote.
      if(!existente.dados.agrupamento_inativo&&existente.dados.valor_bruto===p.dados.valor_bruto&&existente.dados.valor_liquido===p.dados.valor_liquido&&existente.dados.agrupamento_parcelas?.length===p.dados.agrupamento_parcelas.length&&p.dados.agrupamento_parcelas.every((v:Registro,i:number)=>v.id===existente.dados.agrupamento_parcelas[i]?.id&&v.assinatura===existente.dados.agrupamento_parcelas[i]?.assinatura)&&atuais.every((r:any)=>r.dados.agrupamento_erp_id===p.id))continue;
    }
    if(existente)await tx.$executeRawUnsafe(`UPDATE vendas_interdata SET dados=$1::jsonb,data_atualizacao=NOW() WHERE row_id=$2 AND conciliacao_id IS NULL`,JSON.stringify(p.dados),p.id);
    else {await tx.$executeRawUnsafe(`INSERT INTO vendas_interdata(row_id,hash_linha,dados) VALUES($1,$1,$2::jsonb)`,p.id,JSON.stringify(p.dados));criados++;}
    await tx.$executeRawUnsafe(`UPDATE vendas_interdata SET dados=dados||jsonb_build_object('agrupamento_erp_id',$1::text) WHERE row_id=ANY($2::text[]) AND dados->>'agrupamento_erp_id' IS DISTINCT FROM $1::text`,p.id,ids);
  }
  return {criados};
}
export async function validarAgrupamentoSipagTx(tx:Tx,erp:Registro,adqId:string,sqlErp:SqlNaoAplica,sqlAdq:SqlNaoAplica) {
  if(erp.origem_erp!==ORIGEM_GRUPO_SIPAG)return;
  if(erp.agrupamento_inativo||erp.agrupamento_adquirente_id!==adqId)throw new Error('Agrupamento SIPAG indisponível ou adquirente incompatível.');
  const ids=(erp.agrupamento_parcelas||[]).map((v:Registro)=>v.id);
  if(ids.length<2)throw new Error('Agrupamento sem parcelas completas.');
  await tx.$queryRawUnsafe(`SELECT row_id FROM vendas_interdata WHERE row_id=ANY($1::text[]) ORDER BY row_id FOR UPDATE`,ids);
  const f=await lerFontes(tx,sqlErp,sqlAdq,normalizarNsu(erp.nsu));const plano=planejarAgrupamentosSipag(f.erps,f.adqs).find(p=>p.id===erp.id);
  if(!plano||plano.dados.valor_bruto!==erp.valor_bruto||plano.dados.valor_liquido!==erp.valor_liquido||plano.dados.agrupamento_parcelas.length!==erp.agrupamento_parcelas.length||!plano.dados.agrupamento_parcelas.every((p:Registro,i:number)=>p.id===erp.agrupamento_parcelas[i]?.id&&p.assinatura===erp.agrupamento_parcelas[i]?.assinatura))throw new Error('Parcelas alteradas, incompletas, inelegíveis ou ambíguas; agrupamento bloqueado.');
  if(!plano.itens.every(v=>v.agrupamento_erp_id===erp.id))throw new Error('Parcelas já reservadas para outro grupo.');
}
export async function atualizarParcelasGrupoTx(tx:Tx,erpId:string,conciliacaoId:string|null,status:string) {
  const rows=await tx.$queryRawUnsafe(`SELECT dados FROM vendas_interdata WHERE row_id=$1`,erpId);
  const g=rows[0]?.dados;if(g?.origem_erp!==ORIGEM_GRUPO_SIPAG)return;
  const ids=g.agrupamento_parcelas.map((v:Registro)=>v.id);
  const filhos=await tx.$queryRawUnsafe(`SELECT row_id,dados FROM vendas_interdata WHERE row_id=ANY($1::text[]) ORDER BY row_id FOR UPDATE`,ids);
  if(filhos.length!==ids.length||filhos.some((r:any)=>r.dados.agrupamento_erp_id!==erpId))throw new Error('Reserva das parcelas do grupo não está íntegra.');
  await tx.$executeRawUnsafe(`UPDATE vendas_interdata SET dados=dados||jsonb_build_object('conciliacao_agrupamento_id',$1::text,'status_agrupamento',$2::text),data_atualizacao=NOW() WHERE row_id=ANY($3::text[])`,conciliacaoId,status,ids);
  const auditoriaId=conciliacaoId||filhos[0]?.dados.conciliacao_agrupamento_id;
  if(auditoriaId&&filhos.some((r:any)=>r.dados.conciliacao_agrupamento_id!==conciliacaoId||r.dados.status_agrupamento!==status)) {
    await tx.$executeRawUnsafe(`INSERT INTO historico_conciliacoes(conciliacao_id,acao,status_anterior,status_novo,motivo,detalhes)
      VALUES($1,'VINCULO_PARCELAS_ERP',$2,$3,'Atualização atômica das parcelas ERP do grupo SIPAG',$4::jsonb)`,
      auditoriaId,filhos[0]?.dados.status_agrupamento||'PENDENTE',status,
      JSON.stringify({agrupamento_erp_id:erpId,ids_parcelas_erp:ids,valor_bruto:g.valor_bruto,valor_liquido:g.valor_liquido}));
  }
  if(conciliacaoId)await tx.$executeRawUnsafe(`UPDATE conciliacoes SET dados=dados||jsonb_build_object('agrupamento_erp_id',$1::text,'ids_parcelas_erp',$2::jsonb) WHERE row_id=$3`,erpId,JSON.stringify(ids),conciliacaoId);
}
