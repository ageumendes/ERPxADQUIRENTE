/** Aliases SIPAG observados na exportação de 09/09/2026. Nunca aplicados a outra rede. */
export const textoVenda = (x: unknown) => String(x ?? '').trim().toUpperCase();
export function lojaVenda(v: Record<string, any>): string {
  const s=textoVenda(v.codigo_estabelecimento);
  if (!s || /^(0+|-|NULL|N\/A)$/.test(s)) return '';
  if (textoVenda(v.adquirente)==='SIPAG') {
    const aliases:Record<string,string>={'106145980001':'SRG','CB-106145980001':'SRG','116403700001':'NBO','CB-116403700001':'NBO'};
    return aliases[s] || s;
  }
  return s;
}
export function parcelasVenda(x: unknown): string {
 const s=textoVenda(x);if(['1','1X','1/1'].includes(s))return '1/1';
 return /^\d+\/\d+$/.test(s) && s.split('/').every(n=>Number(n)>0) ? s.split('/').map(Number).join('/') : '';
}
export function centavosVenda(x: unknown): number | null {
 let s=String(x??'').trim().replace(/R\$|\s/g,'');if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
 // Trailing decimal zeros are frequent in ALELO. Do not round fractional cents.
 if(!/^-?\d+(?:\.\d{1,2}0*)?$/.test(s))return null;
 const n=Number(s)*100;return Number.isSafeInteger(Math.round(n)) ? Math.round(n) : null;
}
export function horaVenda(x:unknown):string {
 let s=String(x??'');if(/^\d{6}$/.test(s))s=s.slice(0,2)+':'+s.slice(2,4)+':'+s.slice(4);
 if(!/^\d{2}:\d{2}:\d{2}$/.test(s))return '';
 return s.split(':').every((n,i)=>Number(n)<(i===0?24:60))?s:'';
}
export function idVenda(x:unknown):string {
 const s=textoVenda(x);return /^[A-Z0-9]+$/.test(s)&&! /^(0+|NULL|NA|UNDEFINED)$/.test(s)?(/^\d+$/.test(s)?s.replace(/^0+/,''):s):'';
}
export function chaveVenda(v:Record<string,any>):string {
 const date=String(v.data_venda??'').slice(0,10),time=horaVenda(v.hora_venda),value=centavosVenda(v.valor_bruto),store=lojaVenda(v),parcel=parcelasVenda(v.parcelas);
 const auth=idVenda(v.codigo_autorizacao),nsu=idVenda(v.nsu),adq=textoVenda(v.adquirente),status=textoVenda(v.status_transacao),modal=textoVenda(v.modalidade);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!time||!store||!parcel||!adq||!status||!modal||value===null||value<=0||(!auth&&!nsu)||v.utilidade_status==='NAO_UTIL')return '';
 const dt=new Date(date+'T00:00:00Z');if(!Number.isFinite(dt.getTime())||dt.toISOString().slice(0,10)!==date)return '';
 return JSON.stringify([adq,store,date,time,value,auth?'A:'+auth:'N:'+nsu,modal,parcel,status]);
}
