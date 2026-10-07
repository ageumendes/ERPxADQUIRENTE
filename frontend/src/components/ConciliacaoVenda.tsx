import { ParcelasErp } from './ParcelasErp';
import React, { useEffect, useState } from 'react';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { API_URL, apiFetch } from '../lib/api';
import { formatarHoraVenda, formatarLiquidoAdquirente, formatarMoedaBrasil, valorTabela } from '../lib/formatters';
import type { VendaAdquirente, VendaErp, RevisaoCoopcerto } from '../types/vendas';

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
    case 'Hora': return formatarHoraVenda(v.hora_venda);
    case 'Valor': return formatarMoedaBrasil(v.valor_bruto);
    case 'Valor líquido': return lado === 'ADQUIRENTE' ? formatarLiquidoAdquirente(v) : formatarMoedaBrasil(v.valor_liquido);
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
  const [justificativa, setJustificativa] = useState('');
  const [tratando, setTratando] = useState(false);
  const [revisaoLocal, setRevisaoLocal] = useState<RevisaoCoopcerto | null>(null);
  const conciliado = String(venda.status_conciliacao || '').toUpperCase() === 'CONCILIADO';
  const revisao = revisaoLocal || detalhes?.conciliacao.venda_adquirente?.revisao_coopcerto || venda.revisao_coopcerto;
  const requerRevisao = revisao?.status === 'PENDENTE';
  let podeRevisar = false;
  try { podeRevisar = ['ADMINISTRADOR', 'FINANCEIRO'].includes(JSON.parse(sessionStorage.getItem('erp_auth_user') || '{}')?.perfil); } catch { /* O servidor revalida o perfil. */ }

  useEffect(() => {
    setRevisaoLocal(null); setJustificativa('');
  }, [venda.id, venda.revisao_coopcerto?.hash_recebido, venda.revisao_coopcerto?.status]);

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
  async function tratarRevisao() {
    if (!adq?.id || !revisao) return;
    setTratando(true); setErro('');
    try {
      const response = await apiFetch(`${API_URL}/api/vendas-adquirentes/${encodeURIComponent(adq.id)}/revisao-coopcerto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: justificativa, hash_recebido: revisao.hash_recebido }),
      });
      const corpo = await response.json();
      if (!response.ok) throw new Error(corpo.mensagem || 'Não foi possível tratar a revisão.');
      setRevisaoLocal(corpo.revisao_coopcerto); setJustificativa('');
    } catch (error) { setErro(error instanceof Error ? error.message : 'Erro ao tratar revisão.'); }
    finally { setTratando(false); }
  }
  const campos = ['Data', 'Hora', 'Valor', 'Valor líquido', 'Loja', 'Modalidade', 'Bandeira', 'Parcelas', 'NSU', 'Autorização'];
  return <>
    <button type="button" className={`venda-conciliacao-botao ${requerRevisao ? 'revisao' : conciliado ? 'sim' : 'nao'}`} onClick={abrir} title={requerRevisao ? 'Revisão necessária: a COOPCERTO informou uma alteração posterior' : conciliado ? 'Conciliado: abrir comparação' : 'Sem conciliação: abrir registro'} aria-label={requerRevisao ? 'Abrir revisão da atualização COOPCERTO' : conciliado ? 'Abrir comparação da conciliação' : 'Abrir registro sem conciliação'}>
      {requerRevisao ? <TriangleAlert size={15}/> : conciliado ? <CircleCheck size={15} fill="currentColor" stroke="white" strokeWidth={2.5}/> : <CircleX size={15} fill="currentColor" stroke="white" strokeWidth={2.5}/>}
    </button>
    {aberto && <div className="modal-backdrop" onMouseDown={() => setAberto(false)}>
      <div className="conciliacao-modal venda-comparacao-modal" role="dialog" aria-modal="true" aria-label="Comparação ERP e adquirente" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title"><div><h2>ERP × Adquirente</h2><p className="muted">{conciliado ? 'Comparação da conciliação selecionada' : 'Registro sem conciliação'}</p></div><button type="button" className="secondary" onClick={() => setAberto(false)}>Fechar</button></div>
        {carregando && <p>Carregando comparação...</p>}
        {erro && <p className="message" role="alert">{erro}</p>}
        {requerRevisao && <div className="message" role="alert">
          <strong>Revisão necessária</strong>
          <p>A COOPCERTO informou uma alteração posterior. O vínculo histórico foi preservado; novas conciliações estão bloqueadas até a revisão.</p>
          <table><thead><tr><th>Campo</th><th>Antes da alteração</th><th>Recebido</th></tr></thead><tbody>
            {([['status_transacao','Status'],['valor_bruto','Valor bruto'],['valor_taxa','Valor taxa'],['valor_liquido','Valor líquido'],['nsu','NSU']] as const).map(([nome, rotulo]) => <tr key={nome}><th>{rotulo}</th><td>{nome.startsWith('valor_') ? formatarMoedaBrasil(revisao?.anterior[nome]) : valorTabela(revisao?.anterior[nome])}</td><td>{nome.startsWith('valor_') ? formatarMoedaBrasil(revisao?.recebido[nome]) : valorTabela(revisao?.recebido[nome])}</td></tr>)}
          </tbody></table>
          <p>Confira os arquivos de origem e os vínculos antes de tratar a divergência. Para uma venda cancelada, desfaça a conciliação com justificativa em Conciliações → Conciliados → Ver detalhes.</p>
          {podeRevisar && adq && (!adq.conciliacao_id || adq.status_transacao === 'AUTORIZADO') && <div>
            <label>Justificativa da revisão<textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} minLength={10} maxLength={2000} placeholder="Explique por que os dados atuais da venda devem ser mantidos"/></label>
            <button type="button" className="secondary" disabled={tratando || justificativa.trim().length < 10} onClick={tratarRevisao}>{tratando ? 'Registrando revisão...' : 'Confirmar revisão e manter dados atuais'}</button>
          </div>}
        </div>}
        {!carregando && !erro && <div className="venda-comparacao-scroll">{erp?.agrupamento_parcelas?.length && <ParcelasErp venda={erp}/>}
        <table className="conciliacao-comparison-grid"><thead><tr><th>Campo</th><th>ERP</th><th>Adquirente</th><th>Resultado</th></tr></thead><tbody>
          {campos.map((nome) => { const a = campo(erp, 'ERP', nome); const b = campo(adq, 'ADQUIRENTE', nome); const resultado = nome === 'Valor líquido' ? 'Informativo' : !erp || !adq ? 'Sem par' : nome === 'Hora' && detalhes?.conciliacao.diferenca_horario_segundos !== undefined ? Number(detalhes.conciliacao.diferenca_horario_segundos) <= 120 ? '✓ Igual: com diferença de fuso horario' : 'Diferente' : a === b ? '✓ Igual' : 'Diferente'; return <tr key={nome}><th>{nome}</th><td title={a}>{a}</td><td title={b}>{b}</td><td className={resultado.startsWith('✓') ? 'comparison-ok' : resultado === 'Sem par' ? '' : 'comparison-warning'}>{resultado}</td></tr>; })}
        </tbody></table></div>}
        {!carregando && !erro && detalhes && <div className="comparison-meta"><span><strong>Correspondência:</strong> {valorTabela(detalhes.conciliacao.tipo_match)}</span><span><strong>Critérios:</strong> {detalhes.conciliacao.criterios?.join(' · ') || '—'}</span><span><strong>Ajuste de horário:</strong> {detalhes.conciliacao.ajuste_horario_minutos ?? 0} min</span></div>}
      </div>
    </div>}
  </>;
}
