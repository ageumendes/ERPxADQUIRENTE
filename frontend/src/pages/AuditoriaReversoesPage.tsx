import React, { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { API_URL, apiFetch } from '../lib/api';
import { formatarMoedaBrasil, normalizarData } from '../lib/formatters';

type AuditoriaDuplicidade = Record<string, any> & { tabela: string; row_id: string; marcado_em?: string };
type AuditoriaConversao = { id: string | number; tabela: string; row_id: string; regra_id: string; coluna: string; valor_anterior?: string; valor_novo?: string; adquirente?: string; data_conversao?: string; origem?: string; dados?: Record<string, any> };

function dataHoraAuditoria(valor?: string) {
  if (!valor) return '-';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? String(valor) : data.toLocaleString('pt-BR');
}

export function AuditoriaReversoesPage() {
  const [duplicados, setDuplicados] = useState<AuditoriaDuplicidade[]>([]);
  const [conversoes, setConversoes] = useState<AuditoriaConversao[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function carregar() {
    setLoading(true); setMessage('');
    try {
      const [dupResp, convResp] = await Promise.all([
        apiFetch(`${API_URL}/api/auditoria/duplicidades?limite=5000`),
        apiFetch(`${API_URL}/api/auditoria/conversoes?limite=5000`),
      ]);
      const [dupBody, convBody] = await Promise.all([dupResp.json(), convResp.json()]);
      if (!dupResp.ok) throw new Error(dupBody?.mensagem || 'Erro ao carregar duplicidades marcadas.');
      if (!convResp.ok) throw new Error(convBody?.mensagem || 'Erro ao carregar conversões.');
      setDuplicados(dupBody.itens || []);
      setConversoes(convBody.itens || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar auditoria.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void carregar(); }, []);

  async function desmarcarDuplicado(item: AuditoriaDuplicidade) {
    if (!window.confirm('Retornar este item para NÃO DUPLICADO? Nenhuma venda será excluída.')) return;
    try {
      const response = await apiFetch(`${API_URL}/api/auditoria/duplicidades/desmarcar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tabela: item.tabela, row_id: item.row_id }),
      });
      const body = await response.json();
      if (!response.ok || !body.sucesso) throw new Error(body?.mensagem || 'Não foi possível desmarcar o item.');
      setDuplicados((atual) => atual.filter((registro) => !(registro.tabela === item.tabela && registro.row_id === item.row_id)));
      setMessage('Duplicidade desmarcada. O registro voltou a ser tratado como item normal.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Erro ao desmarcar duplicidade.'); }
  }

  async function desfazerConversao(item: AuditoriaConversao) {
    if (!window.confirm(`Desfazer a conversão de ${item.coluna}: “${item.valor_anterior ?? ''}” → “${item.valor_novo ?? ''}”?`)) return;
    try {
      const response = await apiFetch(`${API_URL}/api/auditoria/conversoes/${item.id}/desfazer`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok || !body.sucesso) throw new Error(body?.mensagem || 'Não foi possível desfazer a conversão.');
      setConversoes((atual) => atual.filter((registro) => String(registro.id) !== String(item.id)));
      setMessage(`Conversão desfeita. Valor restaurado: ${body.valor_restaurado ?? '-'}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Erro ao desfazer conversão.'); }
  }

  return (
    <section>
      <div className="page-title-row">
        <div><h1>Auditoria e Reversões</h1><p className="muted">Consulte marcações de duplicidade e conversões aplicadas, sempre do evento mais recente para o mais antigo.</p></div>
        <button className="secondary" onClick={carregar} disabled={loading}><RefreshCcw size={15}/> {loading ? 'Atualizando...' : 'Atualizar'}</button>
      </div>
      {message && <p className="message">{message}</p>}

      <div className="cards audit-summary-cards">
        <div className="card warning"><span>Marcados como duplicados</span><strong>{duplicados.length}</strong></div>
        <div className="card"><span>Conversões reversíveis</span><strong>{conversoes.length}</strong></div>
      </div>

      <div className="panel audit-panel">
        <div className="audit-panel-title"><div><h2>Itens marcados como duplicados</h2><p className="muted">Ordenados pela marcação/atualização mais recente. “Desmarcar” não exclui o registro.</p></div></div>
        <div className="table-wrap audit-table-wrap"><table>
          <thead><tr><th>Marcado em</th><th>Origem</th><th>Data</th><th>Hora</th><th>Valor</th><th>Modalidade</th><th>Parcelas</th><th>NSU</th><th>Grupo</th><th>Ação</th></tr></thead>
          <tbody>
            {duplicados.map((item) => <tr key={`${item.tabela}-${item.row_id}`}>
              <td>{dataHoraAuditoria(item.marcado_em)}</td><td>{item.tabela === 'vendas_interdata' ? 'ERP INTERDATA' : String(item.adquirente || 'ADQUIRENTE')}</td>
              <td>{normalizarData(item.data_venda)}</td><td>{String(item.hora_venda || '-')}</td><td>{formatarMoedaBrasil(item.valor_bruto)}</td>
              <td>{String(item.modalidade || item.forma_pagamento || '-')}</td><td>{String(item.parcelas || '-')}</td><td>{String(item.nsu || '-')}</td><td>{String(item.duplicidade_grupo || '-')}</td>
              <td><button className="secondary" onClick={() => desmarcarDuplicado(item)}>Desmarcar duplicado</button></td>
            </tr>)}
            {duplicados.length === 0 && <tr><td colSpan={10}>Nenhum item está marcado como duplicado.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="panel audit-panel">
        <div className="audit-panel-title"><div><h2>Conversões realizadas</h2><p className="muted">Cada linha representa a conversão de um campo em um item. Desfazer restaura o valor anterior somente naquele registro.</p></div></div>
        <div className="table-wrap audit-table-wrap"><table>
          <thead><tr><th>Convertido em</th><th>Origem</th><th>Adquirente</th><th>Data venda</th><th>Valor</th><th>Campo</th><th>Antes</th><th>Depois</th><th>Regra</th><th>Ação</th></tr></thead>
          <tbody>
            {conversoes.map((item) => { const dados = item.dados || {}; return <tr key={String(item.id)}>
              <td>{dataHoraAuditoria(item.data_conversao)}</td><td>{item.tabela === 'vendas_interdata' ? 'ERP INTERDATA' : 'ADQUIRENTE'}</td><td>{String(item.adquirente || dados.adquirente || '-')}</td>
              <td>{normalizarData(dados.data_venda)}</td><td>{formatarMoedaBrasil(dados.valor_bruto)}</td><td><strong>{item.coluna}</strong></td>
              <td>{String(item.valor_anterior ?? '-')}</td><td>{String(item.valor_novo ?? '-')}</td><td title={String(item.regra_id)}>{String(item.regra_id)}</td>
              <td><button className="desfazer-confirmar" onClick={() => desfazerConversao(item)}>Desfazer conversão</button></td>
            </tr>})}
            {conversoes.length === 0 && <tr><td colSpan={10}>Nenhuma conversão reversível encontrada.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </section>
  );
}


