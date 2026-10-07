import React, {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {VendaErp} from '../types/vendas';
import {formatarMoedaBrasil,valorTabela} from '../lib/formatters';
export function ParcelasErp({venda}:{venda:VendaErp|null|undefined}) {
  const [aberto,setAberto]=useState(false);
  const botao=useRef<HTMLButtonElement>(null);
  const fechar=useRef<HTMLButtonElement>(null);
  const titulo=useId();
  const parcelas=venda?.agrupamento_parcelas;
  useEffect(()=>{
    if(!aberto)return;
    fechar.current?.focus();
    const teclado=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.stopPropagation();setAberto(false);}
      if(e.key==='Tab'){e.preventDefault();fechar.current?.focus();}
    };
    document.addEventListener('keydown',teclado,true);
    return ()=>{document.removeEventListener('keydown',teclado,true);botao.current?.focus();};
  },[aberto]);
  if(!parcelas?.length)return <>{valorTabela(venda?.parcelas)}</>;
  return <>
    <button type="button" ref={botao} className="erp-parcelas-botao" aria-haspopup="dialog" onClick={e=>{e.stopPropagation();setAberto(true);}}>{parcelas.length} parcelas</button>
    {aberto&&createPortal(<div className="erp-parcelas-overlay" onClick={e=>{e.stopPropagation();if(e.target===e.currentTarget)setAberto(false);}}>
      <section className="erp-parcelas-modal" role="dialog" aria-modal="true" aria-labelledby={titulo}>
        <header><h2 id={titulo}>Parcelas originais do ERP</h2><button ref={fechar} type="button" onClick={()=>setAberto(false)} aria-label="Fechar parcelas">Fechar</button></header>
        <p>NSU: {valorTabela(venda?.nsu)} · {parcelas.length} parcelas</p>
        <div className="erp-parcelas-scroll"><table><thead><tr><th>Parcela</th><th>VALOR BRUTO</th><th>VALOR LÍQUIDO</th></tr></thead><tbody>
          {parcelas.map(p=><tr key={p.id}><td>{p.parcelas}</td><td>{formatarMoedaBrasil(p.valor_bruto)}</td><td>{formatarMoedaBrasil(p.valor_liquido)}</td></tr>)}
        </tbody><tfoot><tr><th>Total</th><td>{formatarMoedaBrasil(venda?.valor_bruto)}</td><td>{formatarMoedaBrasil(venda?.valor_liquido)}</td></tr></tfoot></table></div>
      </section>
    </div>,document.body)}
  </>;
}
