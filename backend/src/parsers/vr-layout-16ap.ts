import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { VendaAdquirente } from '../repositorio.js';

export type RegistroVr16ap = { id:string; importacao_id:string; tipo_arquivo:'VR_16AP'; codigo_registro:string; numero_linha:number; linha_original:string; hash_linha:string; dados_json:Record<string,string>; data_criacao:string };
type Campo = [string, number, number];
const CAMPOS: Record<string, Campo[]> = {
 H:[['tipo_registro',1,1],['versao_layout',2,5],['data_geracao',6,13],['hora_geracao',14,19],['sequencia_movimento',20,25],['data_movimento',26,33],['nome_administradora',34,63],['identificacao_destinatario',64,69],['tipo_processamento',70,70],['numero_registro',71,76]],
 V:[['tipo_registro',1,1],['cnpj_loja',2,15],['codigo_filiacao',16,30],['codigo_autorizacao_vr',31,36],['numero_transacao',37,42],['data_transacao',43,50],['hora_transacao',51,56],['tipo_lancamento',57,57],['data_pagamento',58,65],['meio_captura',66,66],['valor_bruto',67,77],['valor_desconto',78,88],['valor_liquido',89,99],['numero_cartao',100,115],['banco',116,118],['agencia',119,124],['conta',125,135],['codigo_produto',136,138],['codigo_rede_captura',139,140],['identificador_unico_transacao',141,152],['numero_parcela',153,155],['quantidade_parcelas',156,158],['numero_registro',159,164]],
 E:[['tipo_registro',1,1],['cnpj_loja',2,15],['codigo_filiacao_original',16,30],['codigo_autorizacao_original',31,36],['numero_transacao_original',37,42],['data_transacao_original',43,50],['codigo_autorizacao_estorno',51,56],['numero_transacao_estorno',57,62],['data_transacao_estorno',63,70],['hora_transacao_estorno',71,76],['data_pagamento',77,84],['meio_captura',85,85],['valor_bruto',86,96],['valor_desconto',97,107],['valor_liquido',108,118],['numero_cartao',119,134],['banco',135,137],['agencia',138,143],['conta',144,154],['codigo_produto',155,157],['codigo_rede_captura',158,159],['identificador_unico_original',160,171],['identificador_unico_estorno',172,183],['numero_parcela',184,186],['quantidade_parcelas',187,189],['numero_registro',190,195]],
 A:[['tipo_registro',1,1],['cnpj_loja',2,15],['data_ajuste',16,23],['data_pagamento',24,31],['tipo_ajuste',32,32],['codigo_ajuste',33,35],['descricao_ajuste',36,65],['valor_bruto',66,76],['valor_desconto',77,87],['valor_liquido',88,98],['banco',99,101],['agencia',102,107],['conta',108,118],['codigo_produto',119,121],['identificador_ajuste',122,133],['numero_registro',134,139]],
 T:[['tipo_registro',1,1],['total_geral_registros',2,7],['numero_registro',8,13]],
};
const TAMANHOS:Record<string,number>={H:76,V:164,E:195,A:139,T:13};
const PRODUTOS:Record<string,string>={'027':'VR BENEFÍCIOS AUX','028':'VR AUTO','030':'VR CULTURA','031':'VR REFEIÇÃO AUX','034':'CARTÃO DA MAMÃE','050':'BANCOVR','051':'VR COMPRAS','068':'VR REFEIÇÃO PAT','069':'VR ALIMENTAÇÃO PAT'};
const REDES:Record<string,string>={'03':'SMARTNET','04':'CIELO','06':'ELAVON','07':'REDE','08':'GETNET','09':'VERO','10':'STONE','11':'PAGSEGURO','12':'MUNDIPAGG','22':'ADYEN'};
const CAPTURA:Record<string,string>={'1':'MANUAL','2':'POS','3':'PDV','4':'INTERNET','5':'URA','9':'OUTROS'};
const campo=(l:string,i:number,f:number)=>l.slice(i-1,f).trim();
const dinheiro=(v:string)=>v.replace(/\D/g,'')?(Number(v.replace(/\D/g,''))/100).toFixed(2):'';
const extrair=(l:string,t:string)=>Object.fromEntries((CAMPOS[t]||[]).map(([n,i,f])=>[n,campo(l,i,f)]));
const hash=(id:string,n:number,l:string)=>crypto.createHash('sha256').update(JSON.stringify({id,layout:'VR_16AP',n,l})).digest('hex');
function venda(id:string,n:number,l:string,d:Record<string,string>,h:string):VendaAdquirente|null {
 if(!['V','E'].includes(d.tipo_registro)) return null; const estorno=d.tipo_registro==='E'; const produto=PRODUTOS[d.codigo_produto]||`VR PRODUTO ${d.codigo_produto}`;
 return {id:`${id}-vr-${d.tipo_registro.toLowerCase()}-${n}`,importacao_id:id,adquirente:'VR',layout_origem:'vr_layout_16ap',tipo_arquivo:'VR_16AP',codigo_registro:d.tipo_registro,numero_linha:n,data_venda:estorno?d.data_transacao_estorno:d.data_transacao,hora_venda:estorno?d.hora_transacao_estorno:d.hora_transacao,data_pagamento:d.data_pagamento,valor_bruto:dinheiro(d.valor_bruto),valor_taxa:dinheiro(d.valor_desconto),valor_liquido:dinheiro(d.valor_liquido),nsu:estorno?d.numero_transacao_estorno:d.numero_transacao,codigo_autorizacao:estorno?d.codigo_autorizacao_estorno:d.codigo_autorizacao_vr,terminal:REDES[d.codigo_rede_captura]||d.codigo_rede_captura,cnpj_estabelecimento:d.cnpj_loja,bandeira:'VR',modalidade:produto,parcelas:`${d.numero_parcela||'001'}/${d.quantidade_parcelas||'001'}`,status_transacao:estorno?'ESTORNADO':'VENDA_AUTORIZADA',codigo_produto:d.codigo_produto,hash_linha:h,linha_original:l,dados_json:{...d,produto_descricao:produto,rede_captura_descricao:REDES[d.codigo_rede_captura]||'',meio_captura_descricao:CAPTURA[d.meio_captura]||''},data_criacao:new Date().toISOString()};
}
export async function parseVrLayout16ap(importacaoId:string,caminhoArquivo:string){
 const b=await fs.readFile(caminhoArquivo); const u=b.toString('utf8'); const texto=u.includes('�')?b.toString('latin1'):u; const linhas=texto.split(/\r?\n/).map(l=>l.replace(/\r/g,'')).filter(l=>l.length>0);
 if(!linhas.length||linhas[0][0]!=='H'||linhas.at(-1)?.[0]!=='T') throw new Error('Arquivo VR 16AP inválido: Header H ou Trailer T ausente.');
 const registros_brutos:RegistroVr16ap[]=[]; const vendas_adquirentes:VendaAdquirente[]=[];
 linhas.forEach((l,index)=>{const t=l[0]?.toUpperCase(); const n=index+1;if(!TAMANHOS[t])throw new Error(`Arquivo VR 16AP inválido: registro ${t||'?'} desconhecido na linha ${n}.`);if(l.length!==TAMANHOS[t])throw new Error(`Arquivo VR 16AP inválido: linha ${n} tipo ${t} possui ${l.length} posições; esperado ${TAMANHOS[t]}.`);const d=extrair(l,t),h=hash(importacaoId,n,l);if(['V','E','A'].includes(t))registros_brutos.push({id:`${importacaoId}-vr-raw-${n}`,importacao_id:importacaoId,tipo_arquivo:'VR_16AP',codigo_registro:t,numero_linha:n,linha_original:l,hash_linha:h,dados_json:d,data_criacao:new Date().toISOString()});const v=venda(importacaoId,n,l,d,h);if(v)vendas_adquirentes.push(v)});
 const total=Number(extrair(linhas.at(-1)!,'T').total_geral_registros||0);if(total!==linhas.length)throw new Error(`Arquivo VR 16AP inválido: Trailer informa ${total} registros, mas o arquivo contém ${linhas.length}.`);
 return {registros_brutos,vendas_adquirentes};
}
