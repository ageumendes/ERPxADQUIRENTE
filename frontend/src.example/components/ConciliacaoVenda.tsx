import React, { useEffect, useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { API_URL, apiFetch } from '../lib/api';
import { formatarMoedaBrasil, valorTabela } from '../lib/formatters';
import type { VendaAdquirente, VendaErp } from '../types/vendas';

type Lado = 'ERP' | 'ADQUIRENTE';
type Venda = VendaErp | VendaAdquirente;
type Detalhes = { conciliacao: { status: string; tipo_match?: string; diferenca_horario_segundos?: number; ajuste_horario_minutos?: number; criterios?: string[]; venda_interdata?: VendaErp | null; venda_adquirente?: VendaAdquirente | null } };

function data(v?: Venda | null) {
  const texto = String(v?.data_venda || '');
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? `${texto.slice(8, 10)}/${texto.slice(5, 7)}/${texto.slice(0, 4)}` : valorTabela(texto);
}

function campo(v: Venda | null | undefined, lado: Lado, nome: string): string {
  if (!v) return '—';
  switch (nome) {
    case 'Data': return data(v);
    case 'Hora': return valorTabela(v.hora_venda);
    case 'Valor': return formatarMoedaBrasil(v.valor_bruto);
    case 'Loja': return valorTabela(v.codigo_estabelecimento || (v as VendaErp).cnpj_estabelecimento);
    case 'Modalidade': return valorTabela(lado === 'ERP' ? (v as VendaErp).tipo_produto : (v as VendaAdquirente).modalidade);
    case 'Bandeira': return valorTabela(v.bandeira);
    case 'Parcelas': return valorTabela(v.parcelas);
    case 'NSU': return valorTabela(v.nsu);
    case 'Autorização': return valorTabela((v as VendaAdquirente).codigo_autorizacao);
    default: return '—';
  }
}

export function NsuCurto({ valor }: { valor?: string }) {
  return <span className="venda-nsu-curto" title={valorTabela(valor)}>{valorTabela(valor)}</span>;
}

export function ConciliacaoVenda({ venda, lado }: { venda: Venda; lado: Lado }) {
  const [aberto, setAberto] = useState(false);
  const [detalhes, setDetalhes] = useState<Detalhes | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const conciliado = String(venda.status_conciliacao || '').toUpperCase() === 'CONCILIADO';

  useEffect(() => {
    if (!aberto) return;
    const fechar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') setAberto(false); };
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [aberto]);

  async function abrir() {
    setAberto(true);
    setErro('');
    setDetalhes(null);
    if (!conciliado) return;
    if (!venda.conciliacao_id) { setErro('Este registro está marcado como conciliado, mas não possui vínculo para consultar.'); return; }
    setCarregando(true);
    try {
      const response = await apiFetch(`${API_URL}/api/conciliacoes/${encodeURIComponent(venda.conciliacao_id)}/detalhes`);
      const corpo = await response.json();
      if (!response.ok) throw new Error(corpo.mensagem || 'Não foi possível carregar a conciliação.');
      setDetalhes(corpo);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível carregar a conciliação.'); }
    finally { setCarregando(false); }
  }

  const erp = detalhes?.conciliacao.venda_interdata || (lado === 'ERP' ? venda as VendaErp : null);
  const adq = detalhes?.conciliacao.venda_adquirente || (lado === 'ADQUIRENTE' ? venda as VendaAdquirente : null);
  const campos = ['Data', 'Hora', 'Valor', 'Loja', 'Modalidade', 'Bandeira', 'Parcelas', 'NSU', 'Autorização'];
  return <>
    <button type="button" className={`venda-conciliacao-botao ${conciliado ? 'sim' : 'nao'}`} onClick={abrir} title={conciliado ? 'Conciliado: abrir comparação' : 'Sem conciliação: abrir registro'} aria-label={conciliado ? 'Abrir comparação da conciliação' : 'Abrir registro sem conciliação'}>
      {conciliado ? <CircleCheck size={15} fill="currentColor" stroke="white" strokeWidth={2.5}/> : <CircleX size={15} fill="currentColor" stroke="white" strokeWidth={2.5}/>}
    </button>
    {aberto && <div className="modal-backdrop" onMouseDown={() => setAberto(false)}>
      <div className="conciliacao-modal venda-comparacao-modal" role="dialog" aria-modal="true" aria-label="Comparação ERP e adquirente" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title"><div><h2>ERP × Adquirente</h2><p className="muted">{conciliado ? 'Comparação da conciliação selecionada' : 'Registro sem conciliação'}</p></div><button type="button" className="secondary" onClick={() => setAberto(false)}>Fechar</button></div>
        {carregando && <p>Carregando comparação...</p>}
        {erro && <p className="message" role="alert">{erro}</p>}
        {!carregando && !erro && <div className="venda-comparacao-scroll"><table className="conciliacao-comparison-grid"><thead><tr><th>Campo</th><th>ERP</th><th>Adquirente</th><th>Resultado</th></tr></thead><tbody>
          {campos.map((nome) => { const a = campo(erp, 'ERP', nome); const b = campo(adq, 'ADQUIRENTE', nome); const resultado = !erp || !adq ? 'Sem par' : nome === 'Hora' && detalhes?.conciliacao.diferenca_horario_segundos !== undefined ? Number(detalhes.conciliacao.diferenca_horario_segundos) <= 120 ? '✓ Igual: com diferença de fuso horario' : 'Diferente' : a === b ? '✓ Igual' : 'Diferente'; return <tr key={nome}><th>{nome}</th><td title={a}>{a}</td><td title={b}>{b}</td><td className={resultado.startsWith('✓') ? 'comparison-ok' : resultado === 'Sem par' ? '' : 'comparison-warning'}>{resultado}</td></tr>; })}
        </tbody></table></div>}
        {!carregando && !erro && detalhes && <div className="comparison-meta"><span><strong>Correspondência:</strong> {valorTabela(detalhes.conciliacao.tipo_match)}</span><span><strong>Critérios:</strong> {detalhes.conciliacao.criterios?.join(' · ') || '—'}</span><span><strong>Ajuste de horário:</strong> {detalhes.conciliacao.ajuste_horario_minutos ?? 0} min</span></div>}
      </div>
    </div>}
  </>;
}
