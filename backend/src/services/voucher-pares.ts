import { lojaVenda, parcelasVenda, centavosVenda } from './identidade-venda.js';
import type { VendaAdquirente } from '../repositories/repositorio.js';

const texto = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const capturaRedes = new Set(['SIPAG', 'SICREDI', 'CIELO']);
const economicasRedes = new Set(['ALELO', 'PLUXEE', 'TICKET', 'VR', 'COOPCERTO', 'LECARD', 'CONVCARD']);
export const redeVoucher = (v: VendaAdquirente) => texto(v.adquirente);
export function identificadorVoucher(v: unknown): string {
  const s = texto(v).replace(/\s/g, '');
  if (!/^[A-Z0-9]+$/.test(s) || /^(0+|NA|NULL|UNDEFINED)$/.test(s)) return '';
  return /^\d+$/.test(s) ? s.replace(/^0+/, '') : s;
}
export function redeCapturaVoucher(v: VendaAdquirente):string {
  const layout=String(v.layout_origem||'').trim().toLowerCase();
  // A conversão do adquirente para COOPCERTO não muda a origem SIPAG.
  if(redeVoucher(v)==='COOPCERTO' && texto(v.bandeira)==='CABAL' && /^sipag(?:_|$)/.test(layout))return 'SIPAG';
  return redeVoucher(v);
}
export const capturaVoucher = (v: VendaAdquirente) => capturaRedes.has(redeCapturaVoucher(v)) && texto(v.modalidade) === 'VOUCHER';
export function economicaVoucher(v: VendaAdquirente): boolean {
  if (capturaVoucher(v) || !economicasRedes.has(redeVoucher(v))) return false;
  if (texto(v.modalidade) === 'VOUCHER') return true;
  // Estes parsers já separam vendas de pagamentos/ajustes. Os códigos de produto
  // ALELO e descrições VR são preservados na importação, antes das conversões.
  const layouts: Record<string,string> = { VR:'vr_layout_16ap', ALELO:'alelo' };
  const prefixo=layouts[redeVoucher(v)];
  return !!prefixo && String(v.layout_origem).startsWith(prefixo) && !/(PIX|CRED|DEBIT)/.test(texto(v.modalidade));
}

function data(v: VendaAdquirente): string {
  const s = String(v.data_venda || '');
  let d = s.slice(0, 10);
  if (/^\d{8}$/.test(s)) d = Number(s.slice(0,4))>=1900 && Number(s.slice(0,4))<=2199 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : `${s.slice(4)}-${s.slice(2,4)}-${s.slice(0,2)}`;
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) d = `${s.slice(6,10)}-${s.slice(3,5)}-${s.slice(0,2)}`;
  const t = Date.parse(`${d}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(t) && new Date(t).toISOString().slice(0,10) === d ? d : '';
}
function centavos(v: VendaAdquirente): number { return centavosVenda(v.valor_bruto) ?? 0; }
function segundos(v: VendaAdquirente): number | null {
  let s = String(v.hora_venda || String(v.data_venda || '').split(/[T ]/)[1] || '');
  if (/^\d{6}$/.test(s)) s = `${s.slice(0,2)}:${s.slice(2,4)}:${s.slice(4)}`;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const [h,m,sec=0] = s.split(':').map(Number);
  return h < 24 && m < 60 && sec < 60 ? h*3600+m*60+sec : null;
}
export function voucherElegivel(v: VendaAdquirente): boolean {
  if ((v as any).revisao_coopcerto?.status === 'PENDENTE') return false;
  const status = [v.status_transacao, v.status_transacao_original, v.codigo_registro === 'E' && !String(v.layout_origem).startsWith('cielo_') ? 'ESTORNADO' : ''].map(texto).join(' ');
  const negativa=/(NEGAD|RECUS|REJEIT|REJECT|DECLIN|DENIED|CANCEL|ESTORN|REVERSED|PENDENT|AJUST|DEVOL|UNAUTHORIZED|NAO AUTORIZ)/.test(status);
  const autorizada=/(AUTORIZAD|APROVAD|AUTHORIZED|EFETUAD|CONFIRMAD|REALIZAD|PROCESSAD|LIQUIDAD|CAPTURAD|PAGO|PAGA)/.test(status)
    || (redeVoucher(v)==='ALELO' && String(v.layout_origem).startsWith('alelo_') && texto(v.status_transacao)==='01');
  return v.utilidade_status !== 'NAO_UTIL' && !negativa && autorizada && centavos(v) > 0 && !!data(v);
}
function parcela(v: VendaAdquirente): string { return parcelasVenda(v.parcelas); }
function cnpj(v: VendaAdquirente): string {
  const j = v.dados_json || {};
  for (const val of [v.cnpj_estabelecimento, j.cnpj_loja, j.cnpj, j.cnpj_estabelecimento, j.identificacao_estabelecimento]) {
    const s = String(val || '').replace(/[.\/\-\s]/g, '').replace(/^0(?=\d{14}$)/, '');
    if (/^\d{14}$/.test(s) && !/^0+$/.test(s)) return s;
  }
  return '';
}
function documentoMascara(v: VendaAdquirente): string {
  const j=v.dados_json || {};
  const s=String(j['Documento'] || j.sipag_autorizacao?.['Documento'] || j.documento_estabelecimento_mascarado || '').replace(/[.\/\-\s]/g,'');
  return /^[\d*]{14}$/.test(s) && s.includes('*') ? s : '';
}
function mascaraCompativel(mask: string, completo: string): boolean {
  return !!mask && !!completo && [...mask].every((c,i)=>c === '*' || c === completo[i]);
}
/** Códigos locais de adquirentes diferentes não identificam, sozinhos, a mesma loja.
 * Usa o código canônico convertido pelo cadastro, CNPJ completo, ou documento
 * mascarado apenas em conjunto com identificador forte e horário (abaixo).
 */
function loja(a: VendaAdquirente,b: VendaAdquirente): 'EXATA'|'MASCARA'|null {
  const ca=cnpj(a), cb=cnpj(b), ma=documentoMascara(a), mb=documentoMascara(b);
  if (ca && cb && ca!==cb) return null;
  if ((ma && cb && !mascaraCompativel(ma,cb)) || (mb && ca && !mascaraCompativel(mb,ca))) return null;
  if (ca && cb) return 'EXATA';
  const codigo=(valor:unknown) => { const s=texto(valor); return s && !/^(-|0+|NULL|N\/A)$/.test(s) ? s : ''; };
  const ea=codigo(lojaVenda(a)), eb=codigo(lojaVenda(b));
  if (ea && ea===eb) return 'EXATA';
  if (mascaraCompativel(ma,cb) || mascaraCompativel(mb,ca)) return 'MASCARA';
  return null;
}
function cartao(v: VendaAdquirente): string {
  const j=v.dados_json || {};
  return texto(j['Nº cartão'] || j.sipag_autorizacao?.['Nº cartão'] || j.numero_cartao || j.cartao_mascarado || j.cardNumber).replace(/\s/g,'');
}
function mesmoCartao(a: VendaAdquirente,b: VendaAdquirente): boolean {
  const ca=cartao(a), cb=cartao(b);
  return /^\d{6}[\d*]+\d{4}$/.test(ca) && /^\d{6}[\d*]+\d{4}$/.test(cb) && ca.slice(0,6)===cb.slice(0,6) && ca.slice(-4)===cb.slice(-4);
}
export function redeEsperadaVoucher(v: VendaAdquirente): string {
  const b=texto(v.bandeira);
  if (b==='CABAL') return 'COOPCERTO';
  if (b==='SODEXO') return 'PLUXEE';
  return economicasRedes.has(b) ? b : '';
}
export type EvidenciaVoucher = { criterio: string; loja: string; diferenca_segundos: number | null; cartao_compativel: boolean };
export function avaliarParVoucher(a: VendaAdquirente,b: VendaAdquirente,tolerancia=60): EvidenciaVoucher|null {
  if (!capturaVoucher(a) || !economicaVoucher(b) || !voucherElegivel(a) || !voucherElegivel(b)) return null;
  if (data(a)!==data(b) || centavos(a)!==centavos(b)) return null;
  const esperado=redeEsperadaVoucher(a);
  if (esperado && esperado!==redeVoucher(b)) return null;
  if (parcela(a) && parcela(b) && parcela(a)!==parcela(b)) return null;
  const local=loja(a,b);
  if (!local) return null;
  const ha=segundos(a), hb=segundos(b), diferenca=ha===null || hb===null ? null : Math.abs(ha-hb);
  const janela=Number.isFinite(tolerancia) ? Math.max(1,Math.min(tolerancia,300)) : 60;
  // Um horário conhecido incompatível bloqueia até coincidências de NSU/autorização.
  if (diferenca!==null && diferenca>janela) return null;
  const aa=identificadorVoucher(a.codigo_autorizacao), ab=identificadorVoucher(b.codigo_autorizacao);
  if (aa && ab && aa!==ab) return null;
  const na=identificadorVoucher(a.nsu), nb=identificadorVoucher(b.nsu);
  let criterio=aa && aa===ab ? 'AUTORIZACAO_DATA_VALOR' : '';
  // CEADM40 preserva o identificador repetido; não o renomeia para autorização.
  if (!criterio && !ab && redeVoucher(b)==='TICKET' && aa && aa===identificadorVoucher(b.dados_json?.identificador_repetido)) criterio='IDENTIFICADOR_TICKET_DATA_VALOR';
  if (!criterio && na && na===nb) criterio='NSU_DATA_VALOR';
  const forte=!!criterio;
  if (local==='MASCARA' && (!forte || diferenca===null)) return null;
  const cartaoIgual=mesmoCartao(a,b);
  // Sem identificador: exige loja exata, cartão compatível e horário presente.
  if (!criterio && local==='EXATA' && cartaoIgual && diferenca!==null) criterio='CARTAO_DATA_VALOR_HORARIO';
  if (!criterio) return null;
  return {criterio,loja:local,diferenca_segundos:diferenca,cartao_compativel:cartaoIgual};
}
export type DecisaoVoucher = { captura: VendaAdquirente; economica?: VendaAdquirente; evidencia?: EvidenciaVoucher; status:'VINCULADO'|'JA_VINCULADO'|'AMBIGUO'|'SEM_VINCULO'; candidatos: string[] };
/** Grafo completo antes de vincular: grau 1 nas duas pontas, inclusive NSU.
 * Vínculos persistidos reservam o destino entre lotes e execuções.
 */
export function selecionarParesVoucher(capturas: VendaAdquirente[], economicas: VendaAdquirente[], tolerancia=60): DecisaoVoucher[] {
  const reservados=new Set(capturas.filter(c=>c.status_vinculo_voucher==='VINCULADO' && c.vinculo_voucher_id).map(c=>c.vinculo_voucher_id!));
  for (const e of economicas) if(e.status_vinculo_voucher==='VINCULADO') reservados.add(e.id);
  const indice=new Map<string,VendaAdquirente[]>();
  for (const e of economicas) {
    const key=`${data(e)}|${centavos(e)}`;
    const grupo=indice.get(key)||[]; grupo.push(e); indice.set(key,grupo);
  }
  const escolhas=new Map<string,Array<{v:VendaAdquirente;e:EvidenciaVoucher}>>();
  const concorrencia=new Map<string,number>();
  for (const c of capturas) {
    if(c.status_vinculo_voucher==='VINCULADO') continue;
    const pares=(indice.get(`${data(c)}|${centavos(c)}`)||[]).flatMap(v=>{const e=avaliarParVoucher(c,v,tolerancia);return e?[{v,e}]:[];});
    escolhas.set(c.id,pares);
    for(const p of pares) concorrencia.set(p.v.id,(concorrencia.get(p.v.id)||0)+1);
  }
  return capturas.map(c=>{
    if(c.status_vinculo_voucher==='VINCULADO') return {captura:c,status:'JA_VINCULADO',candidatos:c.vinculo_voucher_id?[c.vinculo_voucher_id]:[]};
    const pares=escolhas.get(c.id)||[];
    if(pares.length===1 && concorrencia.get(pares[0].v.id)===1 && !reservados.has(pares[0].v.id) && !(c.conciliacao_id && pares[0].v.conciliacao_id && c.conciliacao_id !== pares[0].v.conciliacao_id)) return {captura:c,economica:pares[0].v,evidencia:pares[0].e,status:'VINCULADO',candidatos:[pares[0].v.id]};
    return {captura:c,status:pares.length?'AMBIGUO':'SEM_VINCULO',candidatos:pares.map(p=>p.v.id)};
  });
}
