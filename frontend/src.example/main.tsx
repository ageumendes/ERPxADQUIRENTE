import { SftpFilesDialog } from './components/SftpFilesDialog';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { Upload, RefreshCcw, Database, SearchCheck, AlertTriangle, Table2, Columns3, Trash2, PlusCircle, Pencil, XCircle, CloudDownload, ChevronDown, ChevronLeft, ChevronRight, Server, Maximize2, Minimize2 } from 'lucide-react';
import { theme } from './lib/theme';
import { API_URL, apiFetch, publicApiFetch } from './lib/api';
import { AppShell } from './components/AppShell';
import logoTigre from './assets/logo-tigre.png';
import { formatBytes, statusLabel } from './lib/importacoes';
import { formatarMoedaBrasil, normalizarData, valorTabela } from './lib/formatters';
import type { DashboardPendenciasImportacao, Importacao, ImportacoesPoll } from './types/importacoes';
import { AuditoriaReversoesPage } from './pages/AuditoriaReversoesPage';
import { DuplicidadesPage } from './pages/DuplicidadesPage';
import { UsersPage } from './pages/UsersPage';
import { VendasAdquirentesPage } from './pages/VendasAdquirentesPage';
import { VendasErpPage } from './pages/VendasErpPage';
import { RelatoriosAdquirentesPage } from './pages/RelatoriosAdquirentesPage';
import { RenderAdquirenteLogo, RenderBandeiraLogo, RenderErpLogo } from './components/PaymentLogos';
import { useTamanhoPaginaResponsivo } from './hooks/useTamanhoPaginaResponsivo';
import { rolarParaTopoElemento } from './lib/paginacao';
import { estiloLarguraColuna, LARGURAS_COLUNAS } from './lib/columnWidths';
import type { VendaAdquirente, VendaErp } from './types/vendas';
import './styles.css';

type UsuarioSessao = { id: string; nome: string; login: string; perfil: 'ADMINISTRADOR' | 'FINANCEIRO' | 'AUDITOR' | 'OPERADOR' | 'CONSULTA'; trocar_senha: boolean };

type TabelaBancoResumo = {
  nome: string;
  titulo: string;
  descricao: string;
  quantidade_colunas: number;
  quantidade_linhas: number;
  colunas: string[];
};

type TabelaBancoDetalhe = {
  nome: string;
  titulo: string;
  descricao: string;
  colunas: string[];
  linhas: Record<string, unknown>[];
  total_linhas: number;
  limite: number;
  offset?: number;
};


function statusClasse(status: string) {
  return status.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
}

function statusTipo(status: string) {
  if (['PROCESSADO', 'CLASSIFICADO'].includes(status)) return 'success';
  if (['ERRO', 'EXTENSAO_BLOQUEADA'].includes(status)) return 'danger';
  if (['ARQUIVO_DUPLICADO', 'LAYOUT_DESCONHECIDO'].includes(status)) return 'warning';
  return 'working';
}

function pastaArquivo(item: Importacao) {
  return item.pasta_arquivo || '-';
}

function detalheImportacao(item: Importacao) {
  if (item.status_importacao === 'ARQUIVO_DUPLICADO') return item.mensagem_erro || 'Duplicidade detectada por hash.';
  if (item.status_importacao === 'LAYOUT_DESCONHECIDO') return item.mensagem_erro || 'Layout não reconhecido pelos parsers configurados.';
  if (item.status_importacao === 'ERRO') return item.mensagem_erro || 'Falha técnica no processamento.';
  if (item.status_importacao === 'PROCESSADO') return `${item.quantidade_processados || 0} registro(s) gravado(s).${item.mensagem_erro ? ` ${item.mensagem_erro}` : ''}`;
  return item.mensagem_erro || '-';
}

function Sistema({ usuario, sair }: { usuario: UsuarioSessao; sair: () => void }) {
  return (
    <AppShell usuario={usuario} sair={sair}>
          <Routes>
            <Route path="/" element={<Navigate to="/conciliacoes" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/imports" element={<ImportsPage />} />
            <Route path="/erp-vendas" element={<VendasErpPage />} />
            <Route path="/adquirentes-vendas" element={<VendasAdquirentesPage />} />
            <Route path="/relatorios-adquirentes" element={<RelatoriosAdquirentesPage />} />
            <Route path="/conciliacoes" element={<ConciliacoesPage />} />
            <Route path="/duplicidades" element={usuario.perfil === 'ADMINISTRADOR' ? <DuplicidadesPage /> : <Navigate to="/conciliacoes" replace />} />
            <Route path="/auditoria-reversoes" element={usuario.perfil === 'ADMINISTRADOR' ? <AuditoriaReversoesPage /> : <Navigate to="/conciliacoes" replace />} />
            <Route path="/sftp" element={<Navigate to="/imports" replace />} />
            <Route path="/banco" element={usuario.perfil === 'ADMINISTRADOR' ? <BancoDadosPage /> : <Navigate to="/conciliacoes" replace />} />
            <Route path="/users" element={usuario.perfil === 'ADMINISTRADOR' ? <UsersPage /> : <Navigate to="/conciliacoes" replace />} />
            <Route path="*" element={<Navigate to="/conciliacoes" replace />} />
          </Routes>
    </AppShell>
  );
}

function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendencias, setPendencias] = useState<DashboardPendenciasImportacao | null>(null);
  const [loadingPendencias, setLoadingPendencias] = useState(false);
  const [erroPendencias, setErroPendencias] = useState('');
  const [gruposExpandidos, setGruposExpandidos] = useState<Set<string>>(new Set());

  function dataAtualSaoPaulo() {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const mapa = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
    return `${mapa.year}-${mapa.month}-${mapa.day}`;
  }

  function dataIsoValida(valor: string | null) {
    if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
    const [ano, mes, dia] = valor.split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
  }

  const dataUrl = searchParams.get('data');
  const hoje = dataAtualSaoPaulo();
  const dataReferencia = dataIsoValida(dataUrl) && String(dataUrl) <= hoje ? String(dataUrl) : hoje;

  async function carregarPendencias(data = dataReferencia) {
    setLoadingPendencias(true);
    setErroPendencias('');
    try {
      const response = await apiFetch(`${API_URL}/api/dashboard/pendencias-importacao?data=${encodeURIComponent(data)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível carregar as pendências de importação.');
      setPendencias(await response.json());
    } catch (error) {
      setErroPendencias(error instanceof Error ? error.message : 'Erro ao carregar pendências de importação.');
    } finally {
      setLoadingPendencias(false);
    }
  }

  useEffect(() => {
    if (dataUrl !== dataReferencia) {
      const proximosParametros = new URLSearchParams(searchParams);
      proximosParametros.set('data', dataReferencia);
      setSearchParams(proximosParametros, { replace: true });
      return;
    }
    carregarPendencias(dataReferencia);
  }, [dataReferencia, dataUrl]);

  function navegarDias(dias: number) {
    const [ano, mes, dia] = dataReferencia.split('-').map(Number);
    const novaData = new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
    if (novaData > hoje) return;
    const proximosParametros = new URLSearchParams(searchParams);
    proximosParametros.set('data', novaData);
    setSearchParams(proximosParametros);
  }

  const cards = [
    { label: 'Adquirentes com dados', value: pendencias ? String(pendencias.resumo.importados) : '-', icon: Database, className: 'success' },
    { label: 'Arquivos', value: pendencias ? String(pendencias.resumo.arquivos) : '-', icon: Table2, className: 'success' },
    { label: 'Registros da data', value: pendencias ? Number(pendencias.resumo.registros).toLocaleString('pt-BR') : '-', icon: SearchCheck, className: 'success' },
    { label: 'Status', value: `v${theme.version}`, icon: SearchCheck, className: '' },
  ];

  function alternarGrupo(grupo: string) {
    setGruposExpandidos((atuais) => {
      const proximos = new Set(atuais);
      if (proximos.has(grupo)) proximos.delete(grupo); else proximos.add(grupo);
      return proximos;
    });
  }

  return (
    <section className="dashboard-page">
      <div className="dashboard-title-row">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Arquivos importados organizados pela data das vendas e itens que eles contêm.</p>
        </div>
        <button className="secondary" onClick={() => carregarPendencias(dataReferencia)} disabled={loadingPendencias}>
          <RefreshCcw size={16}/>{loadingPendencias ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      <div className="cards">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div className={`card ${card.className}`} key={card.label}>
              <div className="card-icon"><Icon size={22}/></div>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </div>
          );
        })}
      </div>

      <div className="panel dashboard-checklist-panel">
        <div className="dashboard-panel-header">
          <div>
            <h2>Importações por data dos itens</h2>
            <div className="dashboard-date-navigation" aria-label="Navegação por data">
              <button className="secondary" type="button" onClick={() => navegarDias(-1)} disabled={loadingPendencias}>
                <ChevronLeft size={16}/>Anterior
              </button>
              <p className="muted">Data de referência: {normalizarData(pendencias?.data_referencia || dataReferencia)}</p>
              <button className="secondary" type="button" onClick={() => navegarDias(1)} disabled={loadingPendencias || dataReferencia >= hoje}>
                Próximo<ChevronRight size={16}/>
              </button>
            </div>
          </div>
          {erroPendencias && <span className="status erro">{erroPendencias}</span>}
        </div>

        <div className="table-wrap dashboard-checklist-wrap">
          <table>
            <thead>
              <tr>
                <th>Adquirente</th>
                <th>Status</th>
                <th>Arquivos</th>
                <th>Registros</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(pendencias?.grupos || []).map((grupo) => (
                <React.Fragment key={grupo.grupo}>
                  <tr className="dashboard-group-row" onClick={() => alternarGrupo(grupo.grupo)}>
                    <td><strong>{grupo.grupo}</strong></td>
                    <td><span className="status processado">Importado</span></td>
                    <td>{grupo.quantidade_arquivos.toLocaleString('pt-BR')}</td>
                    <td>{grupo.quantidade_registros.toLocaleString('pt-BR')}</td>
                    <td><button className="dashboard-expand-button" type="button" aria-label={`Detalhar ${grupo.grupo}`}><ChevronDown className={gruposExpandidos.has(grupo.grupo) ? 'expanded' : ''} size={18}/></button></td>
                  </tr>
                  {gruposExpandidos.has(grupo.grupo) && <tr className="dashboard-detail-row"><td colSpan={5}>
                    <div className="dashboard-files-table"><table><thead><tr>
                      <th>Tipo</th><th>Data dos itens</th><th>Data da importação</th><th>Registros</th><th>Arquivo</th><th>Detalhes</th>
                    </tr></thead><tbody>{grupo.arquivos.map((arquivo) => <tr key={arquivo.importacao_id}>
                      <td><strong>{arquivo.tipo}</strong></td>
                      <td>{normalizarData(arquivo.data_itens)}</td>
                      <td>{arquivo.data_importacao ? new Date(arquivo.data_importacao).toLocaleString('pt-BR') : '-'}</td>
                      <td>{arquivo.quantidade_registros.toLocaleString('pt-BR')}</td>
                      <td title={arquivo.arquivo}>{arquivo.arquivo}</td>
                      <td title={`${arquivo.detalhe} Layout: ${arquivo.layout_detectado}`}>{arquivo.detalhe}</td>
                    </tr>)}</tbody></table></div>
                  </td></tr>}
                </React.Fragment>
              ))}
              {!pendencias && !loadingPendencias && (
                <tr><td colSpan={5}>Nenhuma importação contém vendas na data selecionada.</td></tr>
              )}
              {loadingPendencias && (
                <tr><td colSpan={5}>Carregando importações da data...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel hero-panel">
        <h2>Versão {theme.version}</h2>
        <p>
          O dashboard usa a data das vendas importadas e permite abrir cada adquirente para consultar seus arquivos de origem.
        </p>
      </div>
    </section>
  );
}

function ImportsPage() {
  const tabelaImportsRef = useRef<HTMLDivElement>(null);
  const carregandoPollRef = useRef(false);
  const tamanhoPagina = useTamanhoPaginaResponsivo(tabelaImportsRef, 300);
  const [imports, setImports] = useState<Importacao[]>([]);
  const [poll, setPoll] = useState<ImportacoesPoll | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [excluindoImportacao, setExcluindoImportacao] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [offsetImports, setOffsetImports] = useState(0);

  async function loadImports() {
    if (carregandoPollRef.current || document.visibilityState === 'hidden') return;
    carregandoPollRef.current = true;
    try {
      const response = await apiFetch(`${API_URL}/api/importacoes/poll`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível carregar as importações. Verifique se o backend está online.');
      const data: ImportacoesPoll = await response.json();
      setPoll(data);
      if (Array.isArray(data.importacoes)) setImports(data.importacoes);
      setLastUpdate(data.timestamp || new Date().toISOString());
    } catch (error) {
      try {
        const response = await apiFetch(`${API_URL}/api/importacoes`, { cache: 'no-store' });
        const data = await response.json();
        setImports(data);
        setLastUpdate(new Date().toISOString());
      } catch {
        setMessage(error instanceof Error ? error.message : 'Erro ao carregar importações.');
      }
    } finally {
      carregandoPollRef.current = false;
    }
  }

  useEffect(() => {
    loadImports();
    const timer = window.setInterval(loadImports, 7000);
    const atualizarAoVoltar = () => { if (document.visibilityState === 'visible') void loadImports(); };
    document.addEventListener('visibilitychange', atualizarAoVoltar);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', atualizarAoVoltar);
    };
  }, []);


  async function recuperarProcessando() {
    setRecovering(true);
    setMessage('');
    try {
      const response = await apiFetch(`${API_URL}/api/importacoes/recovery/processando`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limite: 50 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Erro ao recuperar arquivos em processando/.');
      setMessage(data.mensagem || `${data.recuperados || 0} arquivo(s) recuperado(s).`);
      await loadImports();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao recuperar arquivos em processando/.');
    } finally {
      setRecovering(false);
    }
  }

  async function excluirRegistroImportacao(item: Importacao) {
    if (!window.confirm(`Excluir do histórico o registro de ${item.nome_arquivo_original}? O arquivo físico e as vendas permanecem no banco. Se estiver na pasta entrada, o serviço poderá importá-lo novamente.`)) return;
    setExcluindoImportacao(item.id);
    try {
      const response = await apiFetch(`${API_URL}/api/importacoes/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Erro ao excluir registro de importação.');
      setMessage(data.mensagem);
      await loadImports();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao excluir registro de importação.');
    } finally {
      setExcluindoImportacao(null);
    }
  }

  async function uploadFile() {
    if (files.length === 0) return;
    // O mesmo clique também dispara a rotina SFTP. O painel mantém a regra de credencial e provedores selecionados.
    window.dispatchEvent(new CustomEvent('erpx:sftp-coletar'));
    setUploading(true);
    setMessage('');
    try {
      const resultados: string[] = [];
      for (const arquivo of files) {
        const formData = new FormData();
        formData.append('file', arquivo);
        const response = await apiFetch(`${API_URL}/api/importacoes/upload`, { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(`${arquivo.name}: ${data.mensagem || 'Erro ao enviar arquivo.'}`);
        resultados.push(`${arquivo.name}: ${data.mensagem || 'enviado para classificação'}`);
      }
      setMessage(resultados.join(' | '));
      setFiles([]);
      await loadImports();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao enviar arquivo.');
    } finally {
      setUploading(false);
    }
  }

  const stats = useMemo(() => ({
    total: imports.length,
    recebidos: imports.filter((item) => ['RECEBIDO', 'ENFILEIRADO', 'RECUPERADO_REENFILEIRADO'].includes(item.status_importacao)).length,
    emAndamento: imports.filter((item) => ['CLASSIFICANDO', 'PROCESSANDO', 'PROCESSANDO_FILA'].includes(item.status_importacao)).length,
    processados: imports.filter((item) => item.status_importacao === 'PROCESSADO').length,
    duplicados: imports.filter((item) => item.status_importacao === 'ARQUIVO_DUPLICADO').length,
    desconhecidos: imports.filter((item) => item.status_importacao === 'LAYOUT_DESCONHECIDO').length,
    erros: imports.filter((item) => ['ERRO', 'EXTENSAO_BLOQUEADA'].includes(item.status_importacao)).length,
  }), [imports]);

  const limiteImports = tamanhoPagina;
  const totalImports = imports.length;
  const importsPaginadas = imports.slice(offsetImports, offsetImports + limiteImports);

  useEffect(() => {
    if (offsetImports >= totalImports && offsetImports > 0) {
      setOffsetImports(Math.max(0, Math.floor(Math.max(totalImports - 1, 0) / limiteImports) * limiteImports));
    }
  }, [offsetImports, totalImports, limiteImports]);

  function paginaAnteriorImports() {
    const novoOffset = Math.max(0, offsetImports - limiteImports);
    setOffsetImports(novoOffset);
    rolarParaTopoElemento(tabelaImportsRef);
  }

  function proximaPaginaImports() {
    const novoOffset = offsetImports + limiteImports;
    if (novoOffset >= totalImports) return;
    setOffsetImports(novoOffset);
    rolarParaTopoElemento(tabelaImportsRef);
  }

  return (
    <section>
      {/*<h1>Importações</h1>
      <p className="muted">Acompanhamento em tempo real do pipeline: entrada → fila/processando → processados ou erro/duplicidades, erro/layout_desconhecido e erro/falha_importacao.</p>

      <div className="cards import-status-cards">
        <div className="card">{<span>Total:</span>}<strong>{stats.total}</strong></div>
        <div className="card"><span>Recebidos/Fila:</span><strong>{stats.recebidos + (poll?.fila_importacao?.pendentes || 0)}</strong></div>
        <div className="card warning"><span>Em processamento:</span><strong>{stats.emAndamento}</strong></div>
        <div className="card success"><span>Processados:</span><strong>{stats.processados}</strong></div>
        <div className="card warning"><span>Duplicados:</span><strong>{stats.duplicados}</strong></div>
        <div className="card warning"><span>Layout desconhecido:</span><strong>{stats.desconhecidos}</strong></div>
        <div className="card danger"><span>Falhas:</span><strong>{stats.erros}</strong></div>
      </div>*/}

     {/* <div className="panel live-panel">
        {/*<div>
          <h2>Status em tempo real</h2>
          <p className="muted">Atualização automática a cada 2 segundos. Última leitura: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString('pt-BR') : '-'}</p>
        </div>
        <div className="live-grid">
          <span><strong>Trabalhos:</strong> {poll?.fila_importacao?.rodando ? 'processando' : 'aguardando'}</span>
          <span><strong>Pendentes:</strong> {poll?.fila_importacao?.pendentes ?? 0}</span>
          <span><strong>Atual:</strong> {poll?.fila_importacao?.atual?.nome_arquivo_original || '-'}</span>
          <span><strong>SFTP:</strong> {poll?.sftp ? 'monitorado' : 'sem dados'}</span>
          <span><strong>Presos em processando/:</strong> {String(poll?.pastas_importacao?.processando ?? 0)}</span>
        </div>
      </div>*/}

      <div className="panel upload-panel">
        <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        <button onClick={uploadFile} disabled={files.length === 0 || uploading}><Upload size={16}/>{uploading ? 'Enviando...' : files.length > 1 ? `Enviar ${files.length} arquivos` : 'Enviar arquivo'}</button>
        <button className="secondary" onClick={loadImports}><RefreshCcw size={16}/> Atualizar</button>
        {/*<button className="secondary" onClick={recuperarProcessando} disabled={recovering}><RefreshCcw size={16}/>{recovering ? 'Recuperando...' : 'Recuperar próximos 50'}</button>*/}
        {files.length > 0 && <p className="muted">Selecionados: {files.map((arquivo) => arquivo.name).join(', ')}</p>}
        {/*message && <p className="message">{message}</p>*/}
      </div>

      <SftpImportPanel onImportacoesAlteradas={loadImports} />

      <div className="panel imports-table-panel" ref={tabelaImportsRef}>
        <div className="db-title-row">
          <div>
            <h2>Histórico de importações</h2>
            {/*<p className="muted">Cada linha mostra o status mais recente salvo pelo backend, a pasta física de destino, contadores de registros e detalhes de erro quando houver.</p>*/}
          </div>
          <span className="muted">Exibindo {totalImports === 0 ? 0 : offsetImports + 1}–{Math.min(offsetImports + importsPaginadas.length, totalImports)} de {totalImports}</span>
        </div>

        <div className="table-pagination-shell">
          <button className="page-nav page-nav-left" onClick={paginaAnteriorImports} disabled={offsetImports === 0} title="Página anterior" aria-label="Página anterior"><ChevronLeft size={22}/></button>
          <div className="table-wrap imports-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Status</th>
                  <th>Pasta</th>
                  <th>Origem</th>
                  <th>Layout</th>
                  <th>Registros</th>
                  <th>Processados</th>
                  <th>Erros</th>
                  <th>Tamanho</th>
                  <th>Atualizado</th>
                  <th>Detalhe</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {importsPaginadas.map((item) => (
                  <tr key={item.id} className={`row-${statusTipo(item.status_importacao)}`}>
                    <td title={item.nome_arquivo_original}>{item.nome_arquivo_original}</td>
                    <td><span className={`status ${statusClasse(item.status_importacao)}`}>{statusLabel(item.status_importacao)}</span></td>
                    <td><code>{pastaArquivo(item)}</code></td>
                    <td>{item.origem_detectada || '-'}</td>
                    <td title={item.layout_detectado || '-'}>{item.layout_detectado || '-'}</td>
                    <td>{item.quantidade_registros}</td>
                    <td>{item.quantidade_processados}</td>
                    <td>{item.quantidade_erros}</td>
                    <td>{formatBytes(item.tamanho_bytes)}</td>
                    <td>{new Date(item.data_atualizacao || item.data_importacao).toLocaleString('pt-BR')}</td>
                    <td title={detalheImportacao(item)}>{detalheImportacao(item)}</td>
                    <td>{['ERRO', 'ARQUIVO_DUPLICADO', 'RECEBIDO', 'ENFILEIRADO', 'CLASSIFICANDO', 'PROCESSANDO', 'PROCESSANDO_FILA', 'RECUPERADO_REENFILEIRADO'].includes(item.status_importacao) ? <button className="danger-button tiny-button" onClick={() => void excluirRegistroImportacao(item)} disabled={excluindoImportacao !== null} title="Excluir registro do histórico (importações em andamento exigem fila parada e cinco minutos sem atualização)" aria-label={`Excluir registro ${item.nome_arquivo_original}`}><Trash2 size={14}/></button> : '-'}</td>
                  </tr>
                ))}
                {importsPaginadas.length === 0 && <tr><td colSpan={12}>Nenhum arquivo importado ainda.</td></tr>}
              </tbody>
            </table>
          </div>
          <button className="page-nav page-nav-right" onClick={proximaPaginaImports} disabled={offsetImports + importsPaginadas.length >= totalImports} title="Próxima página" aria-label="Próxima página"><ChevronRight size={22}/></button>
        </div>
      </div>
    </section>
  );
}


function exibirCelulaComConversao(linha: Record<string, unknown>, coluna: string) {
  const valoresExibicao = linha.valores_exibicao as Record<string, unknown> | undefined;
  const original = linha[coluna];
  const convertido = valoresExibicao?.[coluna];
  if (convertido !== undefined && convertido !== original) {
    return <span title={`Valor original: ${valorTabela(original)}`}>{valorTabela(convertido)} <small className="conversion-mark">convertido</small></span>;
  }
  return <span title={valorTabela(original)}>{valorTabela(original)}</span>;
}

function BancoDadosPage() {
  const tabelaBancoRef = useRef<HTMLDivElement>(null);
  const [tabelas, setTabelas] = useState<TabelaBancoResumo[]>([]);
  const [selecionada, setSelecionada] = useState<string>('');
  const [detalhe, setDetalhe] = useState<TabelaBancoDetalhe | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [limpando, setLimpando] = useState(false);
  const [aplicandoConversoes, setAplicandoConversoes] = useState(false);
  const [consolidandoVoucher, setConsolidandoVoucher] = useState(false);
  const [relatorioConversoes, setRelatorioConversoes] = useState<any>(null);
  const [origensConversao, setOrigensConversao] = useState<string[]>([]);
  const [offsetBanco, setOffsetBanco] = useState(0);
  const tamanhoPaginaBanco = useTamanhoPaginaResponsivo(tabelaBancoRef, 330);
  const [formConversao, setFormConversao] = useState({ id: '', tabela_origem: 'vendas_interdata', coluna_origem: 'forma_pagamento', tipo_conversao: 'VALOR_EXATO', formato_origem: 'DDMMYYYY', formato_destino: 'YYYY-MM-DD', valor_original: '', valor_exibicao: '', adquirente_aplicacao: '' });

  async function carregarOrigensConversao() {
    try {
      const response = await apiFetch(`${API_URL}/api/conversoes/origens`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível carregar as origens.');
      setOrigensConversao(Array.isArray(data.origens) ? data.origens : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar adquirentes e ERPs.');
    }
  }

  async function carregarTabelas() {
    setMessage('');
    try {
      const response = await apiFetch(`${API_URL}/api/banco/tabelas`);
      if (!response.ok) throw new Error('Não foi possível carregar a lista de tabelas.');
      const data: TabelaBancoResumo[] = await response.json();
      setTabelas(data);
      if (!selecionada && data[0]) {
        setSelecionada(data[0].nome);
        await abrirTabela(data[0].nome, 0);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar tabelas.');
    }
  }

  async function abrirTabela(nome: string, novoOffset = 0) {
    setLoading(true);
    setMessage('');
    setSelecionada(nome);
    setOffsetBanco(novoOffset);
    try {
      const response = await apiFetch(`${API_URL}/api/banco/tabelas/${nome}?limite=${tamanhoPaginaBanco}&offset=${novoOffset}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível abrir a tabela.');
      setDetalhe(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao abrir tabela.');
    } finally {
      setLoading(false);
    }
  }


  async function limparTabelaAtual() {
    if (!selecionada || !detalhe) return;
    const confirmou = window.confirm(`ATENÇÃO: deseja apagar todos os dados da tabela ${selecionada}? Esta ação não pode ser desfeita.`);
    if (!confirmou) return;

    setLimpando(true);
    setMessage('');
    try {
      const response = await apiFetch(`${API_URL}/api/banco/tabelas/${selecionada}/limpar`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível limpar a tabela.');
      setMessage(data.mensagem || 'Tabela limpa com sucesso.');
      await carregarTabelas();
      await abrirTabela(selecionada, 0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao limpar tabela.');
    } finally {
      setLimpando(false);
    }
  }

  async function cadastrarConversao(event: React.FormEvent) {
    event.preventDefault();
    if (formConversao.tabela_origem === 'vendas_adquirentes' && formConversao.coluna_origem === 'percentual_taxa') {
      setMessage('percentual_taxa é calculado automaticamente a partir de valor_bruto e valor_taxa e não aceita conversão manual.');
      return;
    }
    setMessage('');
    try {
      const editando = Boolean(formConversao.id);
      const response = await apiFetch(editando ? `${API_URL}/api/conversoes/${formConversao.id}` : `${API_URL}/api/conversoes`, {
        method: editando ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formConversao, ativo: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível salvar a conversão.');
      setMessage(data.mensagem || (editando ? 'Conversão atualizada com sucesso.' : 'Conversão cadastrada com sucesso.'));
      setFormConversao({
        id: '',
        tabela_origem: formConversao.tabela_origem,
        coluna_origem: formConversao.coluna_origem,
        tipo_conversao: formConversao.tipo_conversao,
        formato_origem: formConversao.formato_origem,
        formato_destino: formConversao.formato_destino,
        valor_original: '',
        valor_exibicao: '',
        adquirente_aplicacao: formConversao.adquirente_aplicacao,
      });
      await Promise.all([carregarTabelas(), abrirTabela('conversoes', editando ? offsetBanco : 0), carregarOrigensConversao()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao salvar conversão.');
    }
  }

  function editarConversao(linha: Record<string, unknown>) {
    setFormConversao({
      id: String(linha.id || ''),
      tabela_origem: String(linha.tabela_origem || ''),
      coluna_origem: String(linha.coluna_origem || ''),
      tipo_conversao: String(linha.tipo_conversao || 'VALOR_EXATO'),
      formato_origem: String(linha.formato_origem || 'DDMMYYYY'),
      formato_destino: String(linha.formato_destino || 'YYYY-MM-DD'),
      valor_original: String(linha.valor_original ?? ''),
      valor_exibicao: String(linha.valor_exibicao ?? ''),
      adquirente_aplicacao: String(linha.adquirente_aplicacao || ''),
    });
    setMessage('Editando conversão selecionada. Ajuste os campos e clique em Salvar alterações.');
  }

  function cancelarEdicaoConversao() {
    setFormConversao((atual) => ({ id: '', tabela_origem: atual.tabela_origem, coluna_origem: atual.coluna_origem, tipo_conversao: atual.tipo_conversao, formato_origem: atual.formato_origem, formato_destino: atual.formato_destino, valor_original: '', valor_exibicao: '', adquirente_aplicacao: atual.adquirente_aplicacao }));
    setMessage('');
  }

  async function excluirConversao(id: string) {
    const confirmou = window.confirm('Deseja excluir esta conversão? Esta ação não pode ser desfeita.');
    if (!confirmou) return;
    setMessage('');
    try {
      const response = await apiFetch(`${API_URL}/api/conversoes/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível excluir a conversão.');
      setMessage(data.mensagem || 'Conversão excluída com sucesso.');
      if (formConversao.id === id) cancelarEdicaoConversao();
      const novoOffset = detalhe && detalhe.linhas.length === 1 && offsetBanco > 0 ? Math.max(0, offsetBanco - tamanhoPaginaBanco) : offsetBanco;
      await Promise.all([carregarTabelas(), abrirTabela('conversoes', novoOffset), carregarOrigensConversao()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao excluir conversão.');
    }
  }

  async function aplicarConversoesExistentes() {
    if (!window.confirm('Aplicar todas as conversões ativas em TODOS os registros de vendas_interdata e vendas_adquirentes? Esta operação global pode demorar em bases grandes.')) return;
    setAplicandoConversoes(true);
    setMessage('');
    setRelatorioConversoes(null);
    try {
      const response = await apiFetch(`${API_URL}/api/vendas-adquirentes/normalizar`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível aplicar as conversões.');
      setRelatorioConversoes(data);
      setMessage(`Conversões globais processadas em vendas_interdata e vendas_adquirentes. ${Number(data.resumo_conversoes?.registros_alterados || 0)} registro(s) alterado(s) por ${Number(data.resumo_conversoes?.regras_aplicadas || 0)} regra(s).`);
      await Promise.all([carregarTabelas(), abrirTabela(selecionada, offsetBanco), carregarOrigensConversao()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao aplicar conversões.');
    } finally {
      setAplicandoConversoes(false);
    }
  }

  async function consolidarVoucherManual() {
    if (!window.confirm('Executar agora o JOB Consolidação VOUCHER sobre as vendas já importadas?')) return;
    setConsolidandoVoucher(true);
    setMessage('');
    try {
      const response = await apiFetch(`${API_URL}/api/banco/jobs/consolidacao-voucher`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível executar a Consolidação VOUCHER.');
      const detalheAdquirentes = Array.isArray(data.por_adquirente)
        ? data.por_adquirente
            .filter((item: any) => Number(item.capturas_analisadas || 0) > 0 || Number(item.duplicidades_internas_suprimidas || 0) > 0)
            .map((item: any) => `${item.adquirente}: ${Number(item.vinculos_criados || 0)} vínculo(s), ${Number(item.duplicidades_internas_suprimidas || 0)} duplicidade(s) interna(s)`)
            .join(' • ')
        : '';
      setMessage(`Consolidação VOUCHER concluída. Capturas analisadas: ${Number(data.capturas_analisadas || 0)} • vínculos criados: ${Number(data.vinculos_criados || 0)} • já vinculados: ${Number(data.ja_vinculados || 0)} • duplicidades internas: ${Number(data.duplicidades_internas_suprimidas || 0)} • ambíguos: ${Number(data.ambiguos || 0)} • sem correspondência: ${Number(data.sem_correspondencia || 0)}.${detalheAdquirentes ? ` ${detalheAdquirentes}` : ''}`);
      await Promise.all([carregarTabelas(), abrirTabela(selecionada, offsetBanco)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao executar a Consolidação VOUCHER.');
    } finally {
      setConsolidandoVoucher(false);
    }
  }

  function paginaAnteriorBanco() {
    if (!selecionada || offsetBanco === 0) return;
    abrirTabela(selecionada, Math.max(0, offsetBanco - tamanhoPaginaBanco));
  }

  function proximaPaginaBanco() {
    if (!selecionada || !detalhe) return;
    abrirTabela(selecionada, offsetBanco + tamanhoPaginaBanco);
  }

  useEffect(() => {
    carregarTabelas();
    carregarOrigensConversao();
  }, []);

  useEffect(() => {
    if (selecionada) abrirTabela(selecionada, 0);
  }, [tamanhoPaginaBanco]);

  useEffect(() => {
    const relatorioConversoesAberto = Boolean(relatorioConversoes?.resumo_conversoes);
    if (!relatorioConversoesAberto) return;
    const overflowAnterior = document.body.style.overflow;
    const fecharComEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (relatorioConversoesAberto) setRelatorioConversoes(null);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', fecharComEscape);
    return () => {
      document.body.style.overflow = overflowAnterior;
      document.removeEventListener('keydown', fecharComEscape);
    };
  }, [relatorioConversoes]);

  return (
    <section className="db-page">
     {/* <h1>Banco de Dados</h1>
      <p className="muted">Explorador técnico das tabelas do ERPxADQUIRENTE. Clique no nome da tabela à esquerda para visualizar colunas e linhas armazenadas.</p>
    */}
      <div className="db-explorer">
        <aside className="db-sidebar panel">
          <div className="db-sidebar-header">
            <h2>Tabelas</h2>
            <button className="secondary icon-only" onClick={carregarTabelas} title="Atualizar"><RefreshCcw size={16}/></button>
          </div>
          <div className="db-table-list">
            {tabelas.map((tabela) => (
              <button key={tabela.nome} className={selecionada === tabela.nome ? 'db-table-button active' : 'db-table-button'} onClick={() => abrirTabela(tabela.nome, 0)}>
                <Table2 size={16}/>
                <span>
                  <strong>{tabela.nome}</strong>
                  <small>{tabela.quantidade_linhas} linhas • {tabela.quantidade_colunas} colunas</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="db-content panel">
          {message && <p className="message">{message}</p>}
          {relatorioConversoes?.resumo_conversoes && (
            <div className="conversion-report-overlay" role="presentation" onMouseDown={() => setRelatorioConversoes(null)}>
              <div className="conversion-report-modal" role="dialog" aria-modal="true" aria-label="Relatório da aplicação de conversões" onMouseDown={(event) => event.stopPropagation()}>
                <div className="conversion-report-modal-header">
                  <div>
                    <h2>Relatório da aplicação de conversões</h2>
                    <p className="muted">Resultado da última aplicação manual. Feche esta janela para continuar trabalhando no banco de dados.</p>
                  </div>
                  <button className="secondary conversion-report-close" onClick={() => setRelatorioConversoes(null)} title="Fechar relatório" aria-label="Fechar relatório"><XCircle size={18}/> Fechar</button>
                </div>
                <div className="conversion-report">
                  <div className="conversion-report-summary">
                    <strong>Resumo</strong>
                    <span>Regras ativas: {relatorioConversoes.resumo_conversoes.regras_ativas}</span>
                    <span>Aplicadas: {relatorioConversoes.resumo_conversoes.regras_aplicadas}</span>
                    <span>Sem correspondência: {relatorioConversoes.resumo_conversoes.regras_sem_correspondencia}</span>
                    <span>Com erro: {relatorioConversoes.resumo_conversoes.regras_com_erro}</span>
                    <span>Encontrados: {relatorioConversoes.resumo_conversoes.registros_encontrados}</span>
                    <span>Alterados: {relatorioConversoes.resumo_conversoes.registros_alterados}</span>
                  </div>
                  <div className="table-wrapper conversion-report-table">
                    <table>
                      <thead><tr><th>Tabela</th><th>Coluna</th><th>Adquirente</th><th>Regra</th><th>Encontrados</th><th>Alterados</th><th>Status</th><th>Detalhe</th></tr></thead>
                      <tbody>
                        {(relatorioConversoes.relatorio_regras || []).map((regra: any) => (
                          <tr key={regra.id}>
                            <td>{regra.tabela}</td><td>{regra.coluna}</td><td>{regra.adquirente}</td>
                            <td>{regra.tipo_conversao === 'TRANSFORMACAO_DATA' ? <><code>{regra.formato_origem}</code> → <code>{regra.formato_destino}</code></> : <><code>{String(regra.valor_original ?? '') || '(vazio)'}</code> → <code>{regra.valor_exibicao}</code></>}</td>
                            <td>{regra.registros_encontrados}</td><td>{regra.registros_alterados}</td>
                            <td><span className={`conversion-report-status ${String(regra.status).toLowerCase()}`}>{regra.status}</span></td>
                            <td>{regra.erro || (regra.status === 'SEM_CORRESPONDENCIA' ? 'Nenhum valor original compatível foi encontrado.' : 'Processada sem erro.')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
          {loading && <p className="muted">Carregando dados da tabela...</p>}
          {!loading && detalhe && (
            <>
              <div className="db-title-row">
                <div>
                <h2>Tabela: <span className="db-name">{detalhe.nome}</span></h2>
                {/*<p className="muted">{detalhe.descricao}</p>*/}
                </div>
                <div className="db-counts">
                  <span><Columns3 size={15}/> {detalhe.colunas.length} colunas</span>
                  <span><Table2 size={15}/> {detalhe.total_linhas} linhas</span>
                  <button className="danger-button" onClick={limparTabelaAtual} disabled={limpando || detalhe.total_linhas === 0} title="Apagar todos os dados da tabela atual">
                    <Trash2 size={15}/> {limpando ? 'Limpando...' : 'Limpar'}
                  </button>
                  {detalhe.nome === 'conversoes' && (
                    <>
                      <button className="secondary apply-conversions-button" onClick={aplicarConversoesExistentes} disabled={aplicandoConversoes || consolidandoVoucher} title="Aplicar as conversões ativas aos itens já importados">
                        <RefreshCcw size={15}/> {aplicandoConversoes ? 'Aplicando...' : 'Aplicar conversões'}
                      </button>
                      <button className="secondary voucher-consolidation-button" onClick={consolidarVoucherManual} disabled={consolidandoVoucher || aplicandoConversoes} title="Executar manualmente o JOB Consolidação VOUCHER sem iniciar a conciliação automática">
                        <SearchCheck size={15}/> {consolidandoVoucher ? 'Consolidando...' : 'Consolidar VOUCHER'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="columns-box">
                {detalhe.colunas.map((coluna) => <code key={coluna}>{coluna}</code>)}
              </div>

              {detalhe.nome === 'conversoes' && (
                <form className="conversion-form" onSubmit={cadastrarConversao}>
                  <div>
                    <label>Tabela origem</label>
                    <select value={formConversao.tabela_origem} onChange={(e) => setFormConversao({ ...formConversao, tabela_origem: e.target.value })}>
                      <option value="vendas_interdata">vendas_interdata</option>
                      <option value="vendas_adquirentes">vendas_adquirentes</option>
                    </select>
                  </div>
                  <div>
                    <label>Coluna origem</label>
                    <input value={formConversao.coluna_origem} onChange={(e) => setFormConversao({ ...formConversao, coluna_origem: e.target.value })} placeholder="forma_pagamento" />
                    {formConversao.tabela_origem === 'vendas_adquirentes' && formConversao.coluna_origem === 'percentual_taxa' && (
                      <small className="muted">Campo derivado: o sistema calcula automaticamente (valor_taxa ÷ valor_bruto) × 100.</small>
                    )}
                  </div>
                  <div>
                    <label>Tipo</label>
                    <select value={formConversao.tipo_conversao} onChange={(e) => setFormConversao({ ...formConversao, tipo_conversao: e.target.value })}>
                      <option value="VALOR_EXATO">Valor exato</option>
                      <option value="TRANSFORMACAO_DATA">Transformação de data</option>
                    </select>
                  </div>
                  {formConversao.tipo_conversao === 'TRANSFORMACAO_DATA' ? (
                    <>
                      <div>
                        <label>Formato origem</label>
                        <select value={formConversao.formato_origem} onChange={(e) => setFormConversao({ ...formConversao, formato_origem: e.target.value })}>
                          <option value="DDMMYYYY">DDMMYYYY</option>
                        </select>
                      </div>
                      <div>
                        <label>Formato destino</label>
                        <select value={formConversao.formato_destino} onChange={(e) => setFormConversao({ ...formConversao, formato_destino: e.target.value })}>
                          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label>Valor original</label>
                        <input value={formConversao.valor_original} onChange={(e) => setFormConversao({ ...formConversao, valor_original: e.target.value })} placeholder="Pode ficar vazio" title='Deixe vazio (ou informe apenas espaços) para converter campos sem valor'/>
                        {/*<small className="muted">Deixe vazio (ou informe apenas espaços) para converter campos sem valor.</small>*/}
                      </div>
                      <div>
                        <label>Exibir como</label>
                        <input value={formConversao.valor_exibicao} onChange={(e) => setFormConversao({ ...formConversao, valor_exibicao: e.target.value })} placeholder="CREDITO" />
                      </div>
                    </>
                  )}
                  <div>
                    <label>Adquirente</label>
                    <select value={formConversao.adquirente_aplicacao} onChange={(e) => setFormConversao({ ...formConversao, adquirente_aplicacao: e.target.value })}>
                      <option value="">Todas / não se aplica</option>
                      {origensConversao.map((origem) => <option key={origem} value={origem}>{origem}</option>)}
                    </select>
                  </div>
                  <button type="submit"><PlusCircle size={16}/> {formConversao.id ? 'Salvar alterações' : 'Adicionar conversão'}</button>
                  {formConversao.id && <button type="button" className="secondary" onClick={cancelarEdicaoConversao}><XCircle size={16}/> Cancelar edição</button>}
                </form>
              )}

              <div className="db-page-controls">
                <span className="muted">Exibindo {detalhe.total_linhas === 0 ? 0 : offsetBanco + 1}–{Math.min(offsetBanco + detalhe.linhas.length, detalhe.total_linhas)} de {detalhe.total_linhas}</span>
              </div>

              <div className="table-pagination-shell" ref={tabelaBancoRef}>
                <button className="page-nav page-nav-left" onClick={paginaAnteriorBanco} disabled={offsetBanco === 0 || loading} title="Página anterior" aria-label="Página anterior"><ChevronLeft size={22}/></button>
                <div className="table-wrap db-data-table">
                <table>
                  <thead>
                    <tr>{detalhe.nome === 'conversoes' && <th>Ações</th>}{detalhe.colunas.map((coluna) => <th key={coluna}>{coluna}</th>)}</tr>
                  </thead>
                  <tbody>
                    {detalhe.linhas.map((linha, index) => (
                      <tr key={String(linha.id ?? index)}>
                        {detalhe.nome === 'conversoes' && (
                          <td>
                            <div className="row-actions">
                              <button className="secondary tiny-button" onClick={() => editarConversao(linha)} title="Editar conversão"><Pencil size={13}/> Editar</button>
                              <button className="danger-button tiny-button" onClick={() => excluirConversao(String(linha.id || ''))} title="Excluir conversão"><Trash2 size={13}/> Excluir</button>
                            </div>
                          </td>
                        )}
                        {detalhe.colunas.map((coluna) => <td key={coluna}>{exibirCelulaComConversao(linha, coluna)}</td>)}
                      </tr>
                    ))}
                    {detalhe.linhas.length === 0 && <tr><td colSpan={(detalhe.colunas.length || 1) + (detalhe.nome === 'conversoes' ? 1 : 0)}>Tabela sem registros gravados ainda.</td></tr>}
                  </tbody>
                </table>
                </div>
                <button className="page-nav page-nav-right" onClick={proximaPaginaBanco} disabled={offsetBanco + detalhe.linhas.length >= detalhe.total_linhas || loading} title="Próxima página" aria-label="Próxima página"><ChevronRight size={22}/></button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}


type SftpProviderResultado = {
  provider: string;
  sucesso: boolean;
  mensagem?: string;
  erro?: string;
  total_remoto?: number;
  total_candidatos?: number;
  arquivos?: Array<{
    nome_arquivo: string;
    acao: string;
    importacao_id?: string;
    hash_arquivo?: string;
    mensagem?: string;
  }>;
};

type SftpColetaResultado = {
  sucesso: boolean;
  dryRun: boolean;
  providers: SftpProviderResultado[];
  mensagem?: string;
};

function SftpImportPanel({ onImportacoesAlteradas }: { onImportacoesAlteradas?: () => void | Promise<void> }) {
  const [selecionados, setSelecionados] = useState({ alelo: true, cielo: true, sipag: true, sicredi: true, convcard: true, pluxee: true, sicoob: true, ticket: true, vr: true });
  const [dryRun, setDryRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [arquivosSftpAbertos, setArquivosSftpAbertos] = useState(false);
  const [coleta, setColeta] = useState<SftpColetaResultado | null>(null);
  const [credencialConfigurada, setCredencialConfigurada] = useState<boolean | null>(null);
  const [credencialAtualizadaEm, setCredencialAtualizadaEm] = useState<string | null>(null);
  const chaveInputRef = useRef<HTMLInputElement>(null);

  async function carregarStatusCredencial() {
    const response = await apiFetch(`${API_URL}/api/importacoes/sftp/credencial`);
    if (!response.ok) return;
    const data = await response.json(); setCredencialConfigurada(Boolean(data.configurada)); setCredencialAtualizadaEm(data.atualizado_em || null);
  }
  useEffect(() => { void carregarStatusCredencial(); }, []);

  useEffect(() => {
    const iniciarColetaPeloUpload = () => { void coletarArquivos(); };
    window.addEventListener('erpx:sftp-coletar', iniciarColetaPeloUpload);
    return () => window.removeEventListener('erpx:sftp-coletar', iniciarColetaPeloUpload);
  });

  async function enviarCredencial(file: File) {
    const form = new FormData(); form.append('chave', file);
    const response = await apiFetch(`${API_URL}/api/importacoes/sftp/credencial`, { method: 'POST', body: form });
    const data = await response.json(); if (!response.ok) throw new Error(data.mensagem || 'Não foi possível configurar a chave SFTP.');
    setCredencialConfigurada(true); setCredencialAtualizadaEm(data.atualizado_em || null);
  }

  async function selecionarCredencial(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setLoading(true); setMessage('Validando e protegendo a credencial SFTP...');
    try { await enviarCredencial(file); setMessage('Credencial configurada. Iniciando a coleta...'); await executarColeta(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao configurar credencial.'); setLoading(false); }
    finally { event.target.value=''; }
  }

  async function executarColeta() {
    setLoading(true);
    setMessage('');
    setColeta(null);
    try {
      const response = await apiFetch(`${API_URL}/api/importacoes/sftp/coletar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selecionados, dryRun }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível coletar arquivos SFTP.');
      setColeta(data);
      setMessage(dryRun ? 'Dry run concluído. Nenhum arquivo foi baixado.' : 'Coleta concluída e enviada ao classificador/importador.');
      await onImportacoesAlteradas?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao coletar arquivos SFTP.');
    } finally {
      setLoading(false);
    }
  }

  async function coletarArquivos() {
    if (!credencialConfigurada) { chaveInputRef.current?.click(); return; }
    await executarColeta();
  }


  return (
    <div className="imports-sftp-section">
      {arquivosSftpAbertos && <SftpFilesDialog onClose={() => setArquivosSftpAbertos(false)}/>}
      <div className="panel sftp-panel">
        <div className="db-title-row">
          <div>
            <h2>Importação pelo servidor SFTP</h2>
            <p className="muted">Selecione as fontes para coletar e importar. Para consultar pastas e baixar uma segunda via, abra Arquivos SFTP.</p>
          </div>
          <button className="secondary" onClick={() => setArquivosSftpAbertos(true)}><Server size={16}/> Arquivos SFTP</button>
        </div>

        <div className="sftp-options">
          <input ref={chaveInputRef} type="file" accept=".pem,.key,text/plain" hidden onChange={selecionarCredencial}/>
          <label><input type="checkbox" checked={selecionados.cielo} onChange={(e) => setSelecionados({ ...selecionados, cielo: e.target.checked })}/> CIELO</label>
          <label><input type="checkbox" checked={selecionados.sipag} onChange={(e) => setSelecionados({ ...selecionados, sipag: e.target.checked })}/> SIPAG</label>
          <label><input type="checkbox" checked={selecionados.sicredi} onChange={(e) => setSelecionados({ ...selecionados, sicredi: e.target.checked })}/> SICREDI</label>
          <label><input type="checkbox" checked={selecionados.sicoob} onChange={(e) => setSelecionados({ ...selecionados, sicoob: e.target.checked })}/> SICOOB PIX</label>
          <label><input type="checkbox" checked={selecionados.convcard} onChange={(e) => setSelecionados({ ...selecionados, convcard: e.target.checked })}/> CONVCARD</label>
          <label><input type="checkbox" checked={selecionados.pluxee} onChange={(e) => setSelecionados({ ...selecionados, pluxee: e.target.checked })}/> PLUXEE</label>
          <label><input type="checkbox" checked={selecionados.ticket} onChange={(e) => setSelecionados({ ...selecionados, ticket: e.target.checked })}/> TICKET</label>
          <label><input type="checkbox" checked={selecionados.vr} onChange={(e) => setSelecionados({ ...selecionados, vr: e.target.checked })}/> VR</label>
          <label><input type="checkbox" checked={selecionados.alelo} onChange={(e) => setSelecionados({ ...selecionados, alelo: e.target.checked })}/> ALELO</label>
          {/*<label className="dryrun-option"><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)}/> Apenas listar (não baixar)</label>*/}
          <button onClick={coletarArquivos} disabled={loading || !Object.values(selecionados).some(Boolean)}><CloudDownload size={16}/> {loading ? 'Processando...' : 'Coletar arquivos'}</button>
        </div>
        <p className="muted sftp-credential-status">{credencialConfigurada ? `Credencial SFTP configurada${credencialAtualizadaEm ? ` em ${new Date(credencialAtualizadaEm).toLocaleString('pt-BR')}` : ''}.` : 'Na primeira coleta será solicitada a chave privada do servidor.'}</p>
        {message && <p className="message">{message}</p>}
      </div>


      {/*{coleta && (
        <div className="panel">
          <h2>Arquivos encontrados / processados</h2>
          <div className="table-wrap db-data-table">
            <table>
              <thead>
                <tr>
                  <th>Adquirente</th>
                  <th>Arquivo</th>
                  <th>Ação</th>
                  <th>Importação</th>
                  <th>Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {coleta.providers.flatMap((provider) => (provider.arquivos || []).map((arquivo) => ({ provider: provider.provider, arquivo }))).map((item, index) => (
                  <tr key={`${item.provider}-${item.arquivo.nome_arquivo}-${index}`}>
                    <td>{item.provider}</td>
                    <td title={item.arquivo.nome_arquivo}>{item.arquivo.nome_arquivo}</td>
                    <td><span className="status processado">{item.arquivo.acao}</span></td>
                    <td>{item.arquivo.importacao_id || '-'}</td>
                    <td title={item.arquivo.mensagem || ''}>{item.arquivo.mensagem || '-'}</td>
                  </tr>
                ))}
                {coleta.providers.every((provider) => !provider.arquivos?.length) && <tr><td colSpan={5}>Nenhum arquivo retornado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}*/}
    </div>
  );
}


type ConciliacaoLinha = {
  id: string;
  venda_adquirente_id: string;
  venda_interdata_id: string;
  status: string;
  tipo_match: string;
  score: number;
  criterios_usados?: string[];
  diferenca_valor?: number;
  diferenca_dias?: number;
  data_conciliacao?: string;
  observacoes?: string;
  segundo_melhor_score?: number;
  diferenca_para_segundo?: number;
  quantidade_candidatos_equivalentes?: number;
  diferenca_horario_segundos?: number;
  ajuste_horario_minutos?: number;
  automatico?: boolean;
  confianca?: 'MUITO_ALTA' | 'ALTA' | 'MEDIA' | 'BAIXA';
  venda_adquirente?: VendaAdquirente | null;
  venda_interdata?: VendaErp | null;
};

function ConciliacoesPage() {
  const tabelaRef = useRef<HTMLDivElement>(null);
  const carregarSequenciaRef = useRef(0);
  const manualLimite = 100;
  const [linhas, setLinhas] = useState<ConciliacaoLinha[]>([]);
  const [totalLinhas, setTotalLinhas] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<'PENDENTE' | 'CONCILIADO' | 'SUGERIDO' | 'AMBIGUO'>('PENDENTE');
  const tamanhoPagina = useTamanhoPaginaResponsivo(
    tabelaRef,
    300,
    status === 'CONCILIADO' ? 20 : 28,
    status === 'CONCILIADO' ? 28 : 36,
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [expandidas, setExpandidas] = useState<Set<string>>(() => new Set());
  const [contadores, setContadores] = useState<Record<string, number>>({ pendente: 0, conciliado: 0, sugerido: 0, ambiguo: 0 });
  const [selecionadas, setSelecionadas] = useState<Set<string>>(() => new Set());
  const [filtros, setFiltros] = useState({ estabelecimento:'', adquirente:'', data_inicial:'', data_final:'' });
  const [opcoesEstabelecimentos, setOpcoesEstabelecimentos] = useState<string[]>([]);
  const [opcoesAdquirentes, setOpcoesAdquirentes] = useState<string[]>([]);
  const [detalhes, setDetalhes] = useState<{conciliacao:ConciliacaoLinha;historico:Array<any>}|null>(null);
  const [acaoModal, setAcaoModal] = useState<{acao:'confirmar'|'desfazer';ids:string[]}|null>(null);
  const [motivo, setMotivo] = useState('');
  const [manualAberta, setManualAberta] = useState(false);
  const [manualErp, setManualErp] = useState<VendaErp[]>([]);
  const [manualAdq, setManualAdq] = useState<VendaAdquirente[]>([]);
  const [manualTotalErp, setManualTotalErp] = useState(0);
  const [manualTotalAdq, setManualTotalAdq] = useState(0);
  const [manualOffsetErp, setManualOffsetErp] = useState(0);
  const [manualOffsetAdq, setManualOffsetAdq] = useState(0);
  const [manualErpSelecionado, setManualErpSelecionado] = useState<string>('');
  const [manualAdqSelecionado, setManualAdqSelecionado] = useState<string>('');
  const [manualBuscaErp, setManualBuscaErp] = useState('');
  const [manualBuscaAdq, setManualBuscaAdq] = useState('');
  const [manualRecebimento, setManualRecebimento] = useState(false);
  const [manualMotivo, setManualMotivo] = useState('Conciliação manual validada pelo usuário.');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualMensagem, setManualMensagem] = useState('');

  function alternarDetalhes(item: ConciliacaoLinha) {
    if (!item.venda_adquirente || !item.venda_interdata) return;
    setExpandidas((atuais) => {
      const proximas = new Set(atuais);
      if (proximas.has(item.id)) proximas.delete(item.id);
      else proximas.add(item.id);
      return proximas;
    });
  }

  function dataVendaPadronizada(venda?: VendaErp | VendaAdquirente | null) {
    const texto = String(venda?.data_venda || '').trim();
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return br ? `${br[1]}/${br[2]}/${br[3]}` : valorTabela(texto);
  }

  function horaVenda(venda?: VendaErp | VendaAdquirente | null) {
    const origem = String(venda?.hora_venda || (venda as VendaAdquirente | undefined)?.data_venda_hora || '').trim();
    const match = origem.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}:${match[3] || '00'}` : '-';
  }

  function dataHoraVenda(venda?: VendaErp | VendaAdquirente | null) {
    const data = dataVendaPadronizada(venda);
    const hora = horaVenda(venda);
    if (data === '-' && hora === '-') return '-';
    return `${data}${hora !== '-' ? ` · ${hora}` : ''}`;
  }

  function horaNormalizadaAdquirente(item: ConciliacaoLinha) {
    const origem = horaVenda(item.venda_adquirente);
    const match = origem.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return '-';
    const ajuste = Number(item.ajuste_horario_minutos || 0);
    const total = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + ajuste * 60 + 86400) % 86400;
    return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function ajusteHorario(item: ConciliacaoLinha) {
    const minutos = Number(item.ajuste_horario_minutos || 0);
    const sinal = minutos < 0 ? '−' : '+';
    const absoluto = Math.abs(minutos);
    return `${sinal}${String(Math.floor(absoluto / 60)).padStart(2, '0')}:${String(absoluto % 60).padStart(2, '0')}`;
  }

  function diferencaHorario(item: ConciliacaoLinha) {
    const total = Math.max(0, Number(item.diferenca_horario_segundos || 0));
    const horas = Math.floor(total / 3600);
    const minutos = Math.floor((total % 3600) / 60);
    const segundos = Math.floor(total % 60);
    return horas > 0 ? `${horas}h${String(minutos).padStart(2, '0')}min${String(segundos).padStart(2, '0')}s` : `${minutos}min${String(segundos).padStart(2, '0')}s`;
  }

  function modalidadeErp(venda?: VendaErp | null) {
    return valorTabela(venda?.tipo_produto || venda?.forma_pagamento);
  }

  function nomeErpVenda(venda?: VendaErp | null) {
    const origem = String((venda as any)?.origem_erp || (venda as any)?.dados_originais?.origem || '').trim();
    if (origem.toUpperCase() === 'RECEBIMENTO DE CONTAS' || String(venda?.id_venda_erp || '').startsWith('RECEBIMENTO-')) return 'Recebimento de contas';
    return 'INTERDATA';
  }

  function estabelecimentoVenda(venda?: VendaErp | VendaAdquirente | null) {
    return valorTabela((venda as any)?.codigo_estabelecimento || (venda as any)?.cnpj_estabelecimento);
  }

  function estabelecimentoNaoAplica(valor: unknown) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase() === 'NAOAPLICA';
  }

  function tipoMatchAmigavel(tipo?: string) {
    const mapa: Record<string, string> = {
      NSU: 'NSU',
      AUTORIZACAO: 'Autorização',
      VALOR_DATA: 'Valor + data',
      NSU_VALOR_DATA: 'NSU + valor + data',
      HORARIO_NORMALIZADO: 'Valor + data + horário normalizado',
      HORARIO_FORTE_UNICO: 'Horário forte + candidato único',
      VOUCHER_HORARIO_FORTE: 'Voucher: horário + valor',
      VOUCHER_UNICO_DATA_VALOR_PARCELAS: 'Voucher: data + valor + parcelas',
      MANUAL: 'Manual',
      MANUAL_RECEBIMENTO: 'Manual · Recebimento de contas',
      CANDIDATO_UNICO_JANELA_8H: 'Candidato único na janela de 8h',
    };
    const chave = String(tipo || '').trim().toUpperCase();
    return mapa[chave] || (chave ? chave.replace(/_/g, ' ').toLowerCase().replace(/^./, (letra) => letra.toUpperCase()) : '-');
  }

  function criterioAmigavel(criterio: string) {
    const mapa: Record<string, string> = {
      NSU_VALOR_DATA: 'NSU + valor + data',
      HORARIO_NORMALIZADO: 'Horário normalizado',
      HORARIO_FORTE_UNICO: 'Horário forte + candidato único',
      VOUCHER_UNICO_DATA_VALOR_PARCELAS: 'Voucher: data + valor + parcelas',
      CANDIDATO_UNICO_JANELA_8H: 'Candidato único na janela de 8h',
    };
    const chave = String(criterio || '').trim();
    return mapa[chave.toUpperCase()] || chave.replace(/_/g, ' ');
  }

  function criteriosAmigaveis(item: ConciliacaoLinha) {
    const criterios = (item.criterios_usados || []).filter(Boolean).map(criterioAmigavel);
    return criterios.length ? criterios.join(' · ') : tipoMatchAmigavel(item.tipo_match);
  }

  function formatarDataHoraConciliacao(valor?: string) {
    if (!valor) return '-';
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? valorTabela(valor) : data.toLocaleString('pt-BR');
  }

  function comoFoiConciliado(item: ConciliacaoLinha) {
    const tipo = String(item.tipo_match || '').toUpperCase();
    if (tipo === 'MANUAL_RECEBIMENTO') return 'Manual · Recebimento de contas';
    if (tipo === 'MANUAL') return 'Manual';
    if (item.automatico === true) return `Automática · ${tipoMatchAmigavel(item.tipo_match)}`;
    return `Confirmada pelo usuário · ${tipoMatchAmigavel(item.tipo_match)}`;
  }

  function formatarDataIsoLocal(data: Date) {
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
  }

  async function carregar(proximoOffset = offset, proximoStatus = status, limparSelecao = true, filtrosAplicados = filtros, atualizarContadores = proximoOffset === 0) {
    const sequencia = ++carregarSequenciaRef.current;
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ limite: String(tamanhoPagina), offset: String(proximoOffset), status: proximoStatus, incluir_contadores: atualizarContadores ? '1' : '0' });
      Object.entries(filtrosAplicados).forEach(([chave, valor]) => { if (valor) params.set(chave, valor); });
      const response = await apiFetch(`${API_URL}/api/conciliacoes?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.mensagem || 'Não foi possível carregar as conciliações.');
      if (sequencia !== carregarSequenciaRef.current) return;
      setLinhas(data.linhas || []);
      setTotalLinhas(Number(data.total_linhas || 0));
      setOffset(Number(data.offset || 0));
      if (data.contadores) setContadores(data.contadores);
      if (limparSelecao) setSelecionadas(new Set());
    } catch (error) {
      if (sequencia === carregarSequenciaRef.current) setMessage(error instanceof Error ? error.message : 'Erro ao carregar conciliações.');
    } finally {
      if (sequencia === carregarSequenciaRef.current) setLoading(false);
    }
  }

  async function carregarInicializacaoConciliacoes(filtrosContadores?: typeof filtros) {
    try {
      const params = new URLSearchParams();
      if (filtrosContadores) Object.entries(filtrosContadores).forEach(([chave, valor]) => { if (valor) params.set(chave, valor); });
      const sufixo = params.toString() ? `?${params.toString()}` : '';
      const response = await apiFetch(`${API_URL}/api/conciliacoes/inicializacao${sufixo}`);
      if (!response.ok) return '';
      const data = await response.json();
      const estabelecimentos = new Set<string>(((data.estabelecimentos || []) as string[])
        .map((item) => String(item || '').trim())
        .filter((item) => Boolean(item) && !estabelecimentoNaoAplica(item)));
      setOpcoesEstabelecimentos([...estabelecimentos].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })));
      setOpcoesAdquirentes(((data.adquirentes || []) as string[]).map((item) => String(item || '').trim()).filter(Boolean).sort());
      if (data.contadores) setContadores(data.contadores);
      return /^\d{4}-\d{2}-\d{2}$/.test(String(data?.data_mais_recente || '')) ? String(data.data_mais_recente) : '';
    } catch {
      // Os filtros continuam utilizáveis mesmo que as listas auxiliares não carreguem.
      return '';
    }
  }

  async function executarConciliacao() {
    setLoading(true);
    setMessage('');
    try {
      const response = await apiFetch(`${API_URL}/api/conciliacoes/automaticas/executar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmarAutomatico: true, incluirProvaveis: false, tamanhoLote: 500 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.mensagem || 'Erro ao executar conciliação automática.');
      setMessage(`Conciliação executada: ${data.conciliados || 0} conciliado(s), ${data.sugeridos || 0} sugestão(ões), ${data.ambiguos || 0} ambíguo(s) atual(is) e ${data.ambiguidades_saneadas || 0} ambiguidade(s) histórica(s) saneada(s).`);
      await Promise.all([
        carregar(0, status, true),
        status === 'PENDENTE' && manualAberta ? carregarManual(manualBuscaErp, manualBuscaAdq, 0, 0) : Promise.resolve(),
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao executar conciliação automática.');
    } finally {
      setLoading(false);
    }
  }

  async function simularConciliacao() {
    setLoading(true);
    setMessage('');
    try {
      const response = await apiFetch(`${API_URL}/api/conciliacoes/automaticas/simular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tamanhoLote: 500 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.mensagem || 'Erro ao simular conciliação automática.');
      const classes = data.por_classificacao || {};
      setMessage(`Simulação concluída sem alterar dados: ${data.correspondencias_unicas || 0} match(es) único(s), sendo ${classes.match_exato_nsu || 0} por NSU, ${classes.match_exato_horario || 0} por horário exato e ${classes.candidato_unico_janela_8h || 0} candidato(s) exclusivo(s) na janela de 8h; ${data.ambiguos || 0} par(es) disputado(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao simular conciliação automática.');
    } finally {
      setLoading(false);
    }
  }

  async function acaoConciliacao(ids: string[], acao: 'confirmar' | 'desfazer', motivoAcao: string) {
    setLoading(true);
    setMessage('');
    try {
      const lote = ids.length > 1;
      const response = await apiFetch(lote ? `${API_URL}/api/conciliacoes/lote` : `${API_URL}/api/conciliacoes/${encodeURIComponent(ids[0])}/${acao}`, {
        method: 'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(lote ? {ids,acao,motivo:motivoAcao} : {motivo:motivoAcao}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.mensagem || `Erro ao ${acao} conciliação.`);
      setMessage(lote ? `${data.processados || 0} item(ns) processado(s); ${data.falhas || 0} falha(s).` : acao === 'confirmar' ? 'Match confirmado com sucesso.' : 'Conciliação desfeita com sucesso.');
      setAcaoModal(null); setMotivo('');
      await carregar(offset, status, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Erro ao ${acao} conciliação.`);
    } finally {
      setLoading(false);
    }
  }

  async function carregarManual(
    buscaErp = manualBuscaErp,
    buscaAdq = manualBuscaAdq,
    proximoOffsetErp = manualOffsetErp,
    proximoOffsetAdq = manualOffsetAdq,
    filtrosAplicados = filtros,
    priorizarErpId = manualErpSelecionado,
  ) {
    setManualLoading(true);
    setManualMensagem('');
    try {
      const paramsErp = new URLSearchParams({lado:'ERP',limite:String(manualLimite),offset:String(proximoOffsetErp)});
      const paramsAdq = new URLSearchParams({lado:'ADQUIRENTE',limite:String(manualLimite),offset:String(proximoOffsetAdq)});
      if (buscaErp.trim()) paramsErp.set('busca', buscaErp.trim());
      if (buscaAdq.trim()) paramsAdq.set('busca', buscaAdq.trim());
      if (filtrosAplicados.data_inicial) { paramsErp.set('data_inicial', filtrosAplicados.data_inicial); paramsAdq.set('data_inicial', filtrosAplicados.data_inicial); }
      if (filtrosAplicados.data_final) { paramsErp.set('data_final', filtrosAplicados.data_final); paramsAdq.set('data_final', filtrosAplicados.data_final); }
      if (filtrosAplicados.estabelecimento) { paramsErp.set('estabelecimento', filtrosAplicados.estabelecimento); paramsAdq.set('estabelecimento', filtrosAplicados.estabelecimento); }
      if (filtrosAplicados.adquirente) paramsAdq.set('adquirente', filtrosAplicados.adquirente);
      if (priorizarErpId) paramsAdq.set('priorizar_erp_id', priorizarErpId);
      const [respErp, respAdq] = await Promise.all([
        apiFetch(`${API_URL}/api/conciliacoes/manual/candidatos?${paramsErp.toString()}`),
        apiFetch(`${API_URL}/api/conciliacoes/manual/candidatos?${paramsAdq.toString()}`),
      ]);
      const [dataErp, dataAdq] = await Promise.all([respErp.json(), respAdq.json()]);
      if (!respErp.ok) throw new Error(dataErp?.mensagem || 'Erro ao carregar pendências do ERP.');
      if (!respAdq.ok) throw new Error(dataAdq?.mensagem || 'Erro ao carregar pendências das adquirentes.');
      setManualErp(dataErp.linhas || []);
      setManualAdq(dataAdq.linhas || []);
      setManualTotalErp(Number(dataErp.total_linhas || 0));
      setManualTotalAdq(Number(dataAdq.total_linhas || 0));
      setManualOffsetErp(Number(dataErp.offset || 0));
      setManualOffsetAdq(Number(dataAdq.offset || 0));
      setManualErpSelecionado((id) => (dataErp.linhas || []).some((v:VendaErp)=>v.id===id) ? id : '');
      setManualAdqSelecionado((id) => (dataAdq.linhas || []).some((v:VendaAdquirente)=>v.id===id) ? id : '');
    } catch (error) {
      setManualMensagem(error instanceof Error ? error.message : 'Erro ao carregar a conciliação manual.');
    } finally { setManualLoading(false); }
  }

  async function selecionarVendaErp(id: string) {
    setManualErpSelecionado(id);
    setManualAdqSelecionado('');
    setManualRecebimento(false);
    await carregarManual(manualBuscaErp, manualBuscaAdq, manualOffsetErp, 0, filtros, id);
  }

  async function abrirConciliacaoManual() {
    setManualAberta(true);
    // Recarrega sempre com os filtros atualmente aplicados. Na v0.1.227 as listas
    // podiam sobreviver ao fechamento do painel e reaparecer com um período antigo.
    setManualErpSelecionado('');
    setManualAdqSelecionado('');
    await carregarManual(manualBuscaErp, manualBuscaAdq, 0, 0, filtros, '');
  }

  async function aplicarConciliacaoManual() {
    if (!manualAdqSelecionado || (!manualErpSelecionado && !manualRecebimento)) return;
    setManualLoading(true);
    setManualMensagem('');
    try {
      const response = await apiFetch(`${API_URL}/api/conciliacoes/manual`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({venda_interdata_id:manualErpSelecionado,venda_adquirente_id:manualAdqSelecionado,motivo:manualMotivo,recebimento:manualRecebimento}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.mensagem || 'Erro ao aplicar conciliação manual.');
      setManualMensagem(manualRecebimento ? 'Recebimento conciliado com sucesso. Foi criado o item ERP sintético “Recebimento de contas”.' : 'Match manual aplicado com sucesso. Os dois itens foram removidos das filas pendentes.');
      setManualErpSelecionado(''); setManualAdqSelecionado(''); setManualRecebimento(false);
      await Promise.all([
        carregarManual(manualBuscaErp, manualBuscaAdq, manualOffsetErp, manualOffsetAdq, filtros, ''),
        carregar(0, status, true),
      ]);
    } catch (error) { setManualMensagem(error instanceof Error ? error.message : 'Erro ao aplicar conciliação manual.'); }
    finally { setManualLoading(false); }
  }

  async function abrirDetalhes(id:string) {
    try {
      const response = await apiFetch(`${API_URL}/api/conciliacoes/${encodeURIComponent(id)}/detalhes`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.mensagem || 'Não foi possível abrir os detalhes.');
      setDetalhes(data);
    } catch(error) { setMessage(error instanceof Error?error.message:'Erro ao abrir detalhes.'); }
  }

  function alternarSelecao(id:string) { setSelecionadas(atuais=>{const p=new Set(atuais);p.has(id)?p.delete(id):p.add(id);return p;}); }
  function alternarSelecaoVisiveis() {
    const ids = linhas.filter(item => status === 'SUGERIDO' || status === 'CONCILIADO').map(item=>item.id);
    const todos=ids.length>0&&ids.every(id=>selecionadas.has(id));
    setSelecionadas(atuais=>{const p=new Set(atuais); ids.forEach(id=>todos?p.delete(id):p.add(id)); return p;});
  }

  function rotuloConfianca(item:ConciliacaoLinha) {
    return ({MUITO_ALTA:'Muito alta',ALTA:'Alta',MEDIA:'Média',BAIXA:'Baixa'} as any)[item.confianca || 'BAIXA'];
  }

  async function aplicarFiltros(proximosFiltros = filtros) {
    const hoje = formatarDataIsoLocal(new Date());
    const efetivos = {
      ...proximosFiltros,
      data_inicial: proximosFiltros.data_inicial || hoje,
      data_final: proximosFiltros.data_final || hoje,
    };
    if (efetivos !== filtros) setFiltros(efetivos);
    // v0.1.230: Aplicar atualiza primeiro os quatro cards no mesmo universo dos filtros.
    await carregarInicializacaoConciliacoes(efetivos);
    setManualErpSelecionado('');
    setManualAdqSelecionado('');
    setManualOffsetErp(0);
    setManualOffsetAdq(0);
    if (status === 'PENDENTE') {
      setLinhas([]);
      setTotalLinhas(0);
      await carregarManual(manualBuscaErp, manualBuscaAdq, 0, 0, efetivos, '');
      return;
    }
    await carregar(0, status, true, efetivos, false);
  }

  async function limparFiltros() {
    const hoje = formatarDataIsoLocal(new Date());
    setFiltros({ estabelecimento:'', adquirente:'', data_inicial:hoje, data_final:hoje });
    setManualErpSelecionado('');
    setManualAdqSelecionado('');
    setLinhas([]); setTotalLinhas(0);
    setManualErp([]); setManualAdq([]); setManualTotalErp(0); setManualTotalAdq(0);
  }

  async function aplicarPeriodoRapido(tipo: 'HOJE'|'ONTEM'|'7DIAS'|'MES_ATUAL'|'MES_ANTERIOR') {
    const hoje = new Date();
    let inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    let fim = new Date(inicio);
    if (tipo === 'ONTEM') { inicio.setDate(inicio.getDate() - 1); fim = new Date(inicio); }
    if (tipo === '7DIAS') inicio.setDate(inicio.getDate() - 6);
    if (tipo === 'MES_ATUAL') inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    if (tipo === 'MES_ANTERIOR') {
      inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    }
    const proximos = { ...filtros, data_inicial: formatarDataIsoLocal(inicio), data_final: formatarDataIsoLocal(fim) };
    setFiltros(proximos);
    await aplicarFiltros(proximos);
  }

  function tituloStatus() {
    if (status === 'PENDENTE') return ['Conciliação manual de pendências', 'Compare as vendas do ERP com as transações das adquirentes e vincule manualmente quando necessário.'];
    if (status === 'SUGERIDO') return ['Sugestões para revisão', 'O sistema encontrou uma provável correspondência. Compare os dados antes de confirmar.'];
    if (status === 'AMBIGUO') return ['Revisões ambíguas', 'Existem duas ou mais correspondências possíveis. Escolha a opção correta para cada venda do ERP.'];
    return ['Histórico de conciliações', 'Consulte correspondências já confirmadas e, quando necessário, abra os detalhes ou desfaça com motivo.'];
  }

  function resultadoComparacao(item: ConciliacaoLinha, campo: string, erp: unknown, adq: unknown) {
    if (campo === 'Hora') return item.diferenca_horario_segundos !== undefined ? (Number(item.diferenca_horario_segundos) === 0 ? '✓ Igual' : `Diferença ${diferencaHorario(item)}`) : (String(erp) === String(adq) ? '✓ Igual' : 'Diferente');
    if (campo === 'Valor') return Number(item.diferenca_valor || 0) === 0 ? '✓ Igual' : `Diferença ${formatarMoedaBrasil(item.diferenca_valor)}`;
    const a = String(erp ?? '').trim().toUpperCase();
    const b = String(adq ?? '').trim().toUpperCase();
    if (!a && !b) return '—';
    return a === b ? '✓ Igual' : 'Diferente';
  }

  function renderComparacaoDetalhada(item: ConciliacaoLinha) {
    if (!item.venda_interdata || !item.venda_adquirente) return null;
    const linhasComparacao: Array<[string, React.ReactNode, React.ReactNode, string]> = [
      ['Data', dataVendaPadronizada(item.venda_interdata), dataVendaPadronizada(item.venda_adquirente), resultadoComparacao(item, 'Data', dataVendaPadronizada(item.venda_interdata), dataVendaPadronizada(item.venda_adquirente))],
      ['Hora', horaVenda(item.venda_interdata), horaVenda(item.venda_adquirente), resultadoComparacao(item, 'Hora', horaVenda(item.venda_interdata), horaVenda(item.venda_adquirente))],
      ['Valor', formatarMoedaBrasil(item.venda_interdata.valor_bruto), formatarMoedaBrasil(item.venda_adquirente.valor_bruto), resultadoComparacao(item, 'Valor', item.venda_interdata.valor_bruto, item.venda_adquirente.valor_bruto)],
      ['Loja', estabelecimentoVenda(item.venda_interdata), estabelecimentoVenda(item.venda_adquirente), resultadoComparacao(item, 'Loja', estabelecimentoVenda(item.venda_interdata), estabelecimentoVenda(item.venda_adquirente))],
      ['Modalidade', modalidadeErp(item.venda_interdata), valorTabela(item.venda_adquirente.modalidade), resultadoComparacao(item, 'Modalidade', modalidadeErp(item.venda_interdata), item.venda_adquirente.modalidade)],
      ['Bandeira', valorTabela(item.venda_interdata.bandeira), valorTabela(item.venda_adquirente.bandeira), resultadoComparacao(item, 'Bandeira', item.venda_interdata.bandeira, item.venda_adquirente.bandeira)],
      ['Parcelas', valorTabela(item.venda_interdata.parcelas), valorTabela(item.venda_adquirente.parcelas), resultadoComparacao(item, 'Parcelas', item.venda_interdata.parcelas, item.venda_adquirente.parcelas)],
      ['NSU', valorTabela(item.venda_interdata.nsu), valorTabela(item.venda_adquirente.nsu), resultadoComparacao(item, 'NSU', item.venda_interdata.nsu, item.venda_adquirente.nsu)],
      ['Autorização', valorTabela((item.venda_interdata as any).codigo_autorizacao), valorTabela(item.venda_adquirente.codigo_autorizacao), resultadoComparacao(item, 'Autorização', (item.venda_interdata as any).codigo_autorizacao, item.venda_adquirente.codigo_autorizacao)],
    ];
    return (
      <div className="conciliacao-comparison-card">
        <table className="conciliacao-comparison-grid">
          <thead><tr><th>Campo</th><th>ERP</th><th>Adquirente</th><th>Resultado</th></tr></thead>
          <tbody>{linhasComparacao.map(([campo, erp, adq, resultado]) => <tr key={campo}><th>{campo}</th><td>{erp}</td><td>{adq}</td><td className={resultado.startsWith('✓') ? 'comparison-ok' : resultado === '—' ? '' : 'comparison-warning'}>{resultado}</td></tr>)}</tbody>
        </table>
        <div className="comparison-meta">
          <span><strong>Correspondência:</strong> {tipoMatchAmigavel(item.tipo_match)}</span>
          <span><strong>Critérios:</strong> {criteriosAmigaveis(item)}</span>
          <span><strong>Horário normalizado:</strong> {horaNormalizadaAdquirente(item)} · ajuste {ajusteHorario(item)}</span>
        </div>
      </div>
    );
  }

  const vendaErpSelecionada = manualErp.find((v) => v.id === manualErpSelecionado);
  const vendaAdqSelecionada = manualAdq.find((v) => v.id === manualAdqSelecionado);

  function renderManualWorkspace(telaCheia = false) {
    return (
      <div className={`manual-workspace${telaCheia ? ' fullscreen' : ''}`}>
        {manualMensagem && <p className="message manual-workspace-message">{manualMensagem}</p>}
        <div className="manual-scope-summary">
          <span><strong>Período:</strong> {filtros.data_inicial || 'qualquer data'} → {filtros.data_final || 'qualquer data'}</span>
          <span><strong>Estabelecimento:</strong> {filtros.estabelecimento || 'Todos'}</span>
          <span><strong>Adquirente:</strong> {filtros.adquirente || 'Todas'}</span>
        </div>
        <div className="manual-conciliacao-columns inline-columns">
          <section className="manual-side">
            <div className="manual-side-title">
              <div><span>ERP</span><strong>Vendas ainda não conciliadas</strong></div>
              <span>{manualTotalErp.toLocaleString('pt-BR')} pendente(s)</span>
            </div>
            <div className="manual-search manual-search-filters">
              <input value={manualBuscaErp} onChange={e=>setManualBuscaErp(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')carregarManual(manualBuscaErp,manualBuscaAdq,0,manualOffsetAdq)}} placeholder="Buscar nesta tabela: NSU, autorização ou valor"/>
              <button className="secondary" onClick={()=>carregarManual(manualBuscaErp,manualBuscaAdq,0,manualOffsetAdq)} disabled={manualLoading}>Buscar</button>
            </div>
            <div className="manual-table-wrap"><table><thead><tr><th></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.loja)} title="Loja"><span className="coluna-header-texto">Loja</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.data_venda)} title="Data venda"><span className="coluna-header-texto">Data venda</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.hora)} title="Hora"><span className="coluna-header-texto">Hora</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.valor_bruto)} title="Valor bruto"><span className="coluna-header-texto">Valor bruto</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.modalidade)} title="Modalidade"><span className="coluna-header-texto">Modalidade</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.bandeira)} title="Bandeira"><span className="coluna-header-texto">Bandeira</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.parcelas)} title="Parcelas"><span className="coluna-header-texto">Parcelas</span></th><th className="manual-id-column coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.nsu)} title="NSU"><span className="coluna-header-texto">NSU</span></th><th className="manual-id-column coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.autorizacao)} title="Autorização"><span className="coluna-header-texto">Autorização</span></th></tr></thead><tbody>{manualErp.map(v=><tr key={v.id} className={manualErpSelecionado===v.id?'manual-selected':''} onClick={()=>void selecionarVendaErp(v.id)}><td><input type="radio" checked={manualErpSelecionado===v.id} onClick={e=>e.stopPropagation()} onChange={()=>void selecionarVendaErp(v.id)}/></td><td>{estabelecimentoVenda(v)}</td><td>{dataVendaPadronizada(v)}</td><td>{horaVenda(v)}</td><td>{formatarMoedaBrasil(v.valor_bruto)}</td><td>{modalidadeErp(v)}</td><td className="coluna-limitavel manual-col-bandeira"><RenderBandeiraLogo valor={v.bandeira}/></td><td className="coluna-limitavel manual-col-parcelas">{valorTabela(v.parcelas)}</td><td className="manual-id-column"><span className="manual-id-value" title={valorTabela(v.nsu)}>{valorTabela(v.nsu)}</span></td><td className="manual-id-column"><span className="manual-id-value" title={valorTabela((v as any).codigo_autorizacao)}>{valorTabela((v as any).codigo_autorizacao)}</span></td></tr>)}{manualErp.length===0&&<tr><td colSpan={10}>Nenhuma venda ERP pendente encontrada para os filtros selecionados.</td></tr>}</tbody></table></div>
            <div className="manual-pagination"><span>Exibindo {manualTotalErp===0?0:manualOffsetErp+1}–{Math.min(manualOffsetErp+manualErp.length,manualTotalErp)} de {manualTotalErp.toLocaleString('pt-BR')}</span><div><button className="secondary" disabled={manualLoading||manualOffsetErp===0} onClick={()=>carregarManual(manualBuscaErp,manualBuscaAdq,Math.max(0,manualOffsetErp-manualLimite),manualOffsetAdq)}>Anterior</button><button className="secondary" disabled={manualLoading||manualOffsetErp+manualErp.length>=manualTotalErp} onClick={()=>carregarManual(manualBuscaErp,manualBuscaAdq,manualOffsetErp+manualLimite,manualOffsetAdq)}>Próxima</button></div></div>
          </section>
          <section className="manual-side">
            <div className="manual-side-title">
              <div><span>ADQUIRENTE</span><strong>{manualErpSelecionado ? 'Correspondências mais próximas' : 'Transações ainda não conciliadas'}</strong>{manualErpSelecionado && <small>Priorizadas pela loja, valor, data, horário e identificadores da venda ERP selecionada.</small>}</div>
              <span>{manualTotalAdq.toLocaleString('pt-BR')} pendente(s)</span>
            </div>
            <div className="manual-search manual-search-filters">
              <input value={manualBuscaAdq} onChange={e=>setManualBuscaAdq(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')carregarManual(manualBuscaErp,manualBuscaAdq,manualOffsetErp,0)}} placeholder="Buscar nesta tabela: NSU, autorização ou valor"/>
              <button className="secondary" onClick={()=>carregarManual(manualBuscaErp,manualBuscaAdq,manualOffsetErp,0)} disabled={manualLoading}>Buscar</button>
            </div>
            <div className="manual-table-wrap"><table><thead><tr><th></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.loja)} title="Loja"><span className="coluna-header-texto">Loja</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.data_venda)} title="Data venda"><span className="coluna-header-texto">Data venda</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.hora)} title="Hora"><span className="coluna-header-texto">Hora</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.valor_bruto)} title="Valor bruto"><span className="coluna-header-texto">Valor bruto</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.modalidade)} title="Modalidade"><span className="coluna-header-texto">Modalidade</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.bandeira)} title="Bandeira"><span className="coluna-header-texto">Bandeira</span></th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.parcelas)} title="Parcelas"><span className="coluna-header-texto">Parcelas</span></th><th className="manual-id-column coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.nsu)} title="NSU"><span className="coluna-header-texto">NSU</span></th><th className="manual-id-column coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.autorizacao)} title="Autorização"><span className="coluna-header-texto">Autorização</span></th></tr></thead><tbody>{manualAdq.map(v=><tr key={v.id} className={manualAdqSelecionado===v.id?'manual-selected':''} onClick={()=>setManualAdqSelecionado(v.id)}><td><input type="radio" checked={manualAdqSelecionado===v.id} onChange={()=>setManualAdqSelecionado(v.id)}/></td><td>{estabelecimentoVenda(v)}</td><td>{dataVendaPadronizada(v)}</td><td>{horaVenda(v)}</td><td>{formatarMoedaBrasil(v.valor_bruto)}</td><td>{valorTabela(v.modalidade)}</td><td className="coluna-limitavel manual-col-bandeira"><RenderBandeiraLogo valor={v.bandeira}/></td><td className="coluna-limitavel manual-col-parcelas">{valorTabela(v.parcelas)}</td><td className="manual-id-column"><span className="manual-id-value" title={valorTabela(v.nsu)}>{valorTabela(v.nsu)}</span></td><td className="manual-id-column"><span className="manual-id-value" title={valorTabela(v.codigo_autorizacao)}>{valorTabela(v.codigo_autorizacao)}</span></td></tr>)}{manualAdq.length===0&&<tr><td colSpan={10}>Nenhuma transação de adquirente pendente encontrada para os filtros selecionados.</td></tr>}</tbody></table></div>
            <div className="manual-pagination"><span>Exibindo {manualTotalAdq===0?0:manualOffsetAdq+1}–{Math.min(manualOffsetAdq+manualAdq.length,manualTotalAdq)} de {manualTotalAdq.toLocaleString('pt-BR')}</span><div><button className="secondary" disabled={manualLoading||manualOffsetAdq===0} onClick={()=>carregarManual(manualBuscaErp,manualBuscaAdq,manualOffsetErp,Math.max(0,manualOffsetAdq-manualLimite))}>Anterior</button><button className="secondary" disabled={manualLoading||manualOffsetAdq+manualAdq.length>=manualTotalAdq} onClick={()=>carregarManual(manualBuscaErp,manualBuscaAdq,manualOffsetErp,manualOffsetAdq+manualLimite)}>Próxima</button></div></div>
          </section>
        </div>
        {/*<div className="manual-selection-review">
          <div className="manual-selection-card">
            <span>Venda ERP selecionada</span>
            <strong>{manualRecebimento ? 'Recebimento de contas' : vendaErpSelecionada ? `${dataHoraVenda(vendaErpSelecionada)} · ${formatarMoedaBrasil(vendaErpSelecionada.valor_bruto)}` : 'Nenhuma'}</strong>
            {vendaErpSelecionada && <small>Loja {estabelecimentoVenda(vendaErpSelecionada)} · NSU {valorTabela(vendaErpSelecionada.nsu)}</small>}
          </div>
          <div className="manual-selection-arrow">↔</div>
          <div className="manual-selection-card">
            <span>Adquirente selecionada</span>
            <strong>{vendaAdqSelecionada ? `${valorTabela(vendaAdqSelecionada.adquirente)} · ${dataHoraVenda(vendaAdqSelecionada)} · ${formatarMoedaBrasil(vendaAdqSelecionada.valor_bruto)}` : 'Nenhuma'}</strong>
            {vendaAdqSelecionada && <small>Loja {estabelecimentoVenda(vendaAdqSelecionada)} · NSU {valorTabela(vendaAdqSelecionada.nsu)}</small>}
          </div>
        </div>*/}
        <div className="manual-conciliacao-footer inline-footer">
          <label className={`manual-recebimento-toggle ${manualAdqSelecionado && !manualErpSelecionado ? 'enabled' : ''}`} title={manualAdqSelecionado && !manualErpSelecionado ? 'Cria um item ERP sintético Recebimento de contas usando os dados da adquirente selecionada.' : 'Selecione somente um item da adquirente para habilitar.'}><input type="checkbox" checked={manualRecebimento} disabled={!manualAdqSelecionado||!!manualErpSelecionado} onChange={e=>setManualRecebimento(e.target.checked)}/><span>Recebimento</span></label>
          <input className="manual-motivo" value={manualMotivo} onChange={e=>setManualMotivo(e.target.value)} placeholder="Motivo da conciliação manual"/>
          <button className="manual-match-button" onClick={aplicarConciliacaoManual} disabled={manualLoading||!manualAdqSelecionado||(!manualErpSelecionado&&!manualRecebimento)||manualMotivo.trim().length<3}>{manualLoading?'Processando...':manualRecebimento?'Confirmar recebimento':'Conciliar selecionados'}</button>
          <div className="manual-fullscreen-trigger">
            <button
              className="secondary"
              onClick={telaCheia ? ()=>setManualAberta(false) : abrirConciliacaoManual}
              title={telaCheia ? 'Sair do modo tela cheia' : 'Abrir modo tela cheia'}
              aria-label={telaCheia ? 'Sair do modo tela cheia' : 'Abrir modo tela cheia'}
            >{telaCheia ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
          </div>
        </div>
      </div>
    );
  }

  function renderSugestoes() {
    const selecionaveis = linhas;
    return (
      <div className="table-pagination-shell" ref={tabelaRef}>
        <button className="page-nav page-nav-left" onClick={() => carregar(Math.max(0, offset - tamanhoPagina))} disabled={offset === 0 || loading}><ChevronLeft size={22}/></button>
        <div className="table-wrap db-data-table">
          <table className="conciliacao-sugestoes-table">
            <thead><tr><th><input type="checkbox" checked={selecionaveis.length>0&&selecionaveis.every(i=>selecionadas.has(i.id))} onChange={alternarSelecaoVisiveis} aria-label="Selecionar todas as sugestões visíveis"/></th><th>ERP</th><th>Adquirente</th><th>Data / hora ERP</th><th>Data / hora adquirente</th><th>Valor ERP</th><th>Valor adquirente</th><th>Diferença</th><th>Confiança</th><th>Correspondência</th><th>Ações</th></tr></thead>
            <tbody>{linhas.map((item) => {
              const expandida = expandidas.has(item.id);
              return <React.Fragment key={item.id}>
                <tr className={expandida ? 'conciliacao-row-aberta' : ''}>
                  <td><input type="checkbox" checked={selecionadas.has(item.id)} onChange={()=>alternarSelecao(item.id)} aria-label="Selecionar sugestão"/></td>
                  <td><RenderErpLogo valor={nomeErpVenda(item.venda_interdata)} /></td>
                  <td>{item.venda_adquirente ? <RenderAdquirenteLogo valor={item.venda_adquirente.adquirente} /> : '-'}</td>
                  <td>{dataHoraVenda(item.venda_interdata)}</td>
                  <td>{dataHoraVenda(item.venda_adquirente)}</td>
                  <td>{formatarMoedaBrasil(item.venda_interdata?.valor_bruto)}</td>
                  <td>{formatarMoedaBrasil(item.venda_adquirente?.valor_bruto)}</td>
                  <td><div className="difference-stack"><span>{formatarMoedaBrasil(item.diferenca_valor)}</span><small>{diferencaHorario(item)}</small></div></td>
                  <td><span className={`confianca-badge confianca-${(item.confianca||'BAIXA').toLowerCase()}`}>{rotuloConfianca(item)} · {valorTabela(item.score)}</span></td>
                  <td><div className="match-explanation"><strong>{tipoMatchAmigavel(item.tipo_match)}</strong><small>{criteriosAmigaveis(item)}</small></div></td>
                  <td><div className="inline-actions"><button className="secondary" onClick={()=>alternarDetalhes(item)}>{expandida?'Fechar comparação':'Comparar'}</button><button onClick={()=>setAcaoModal({acao:'confirmar',ids:[item.id]})} disabled={loading}>Confirmar</button></div></td>
                </tr>
                {expandida && <tr className="conciliacao-detail-row"><td colSpan={11}>{renderComparacaoDetalhada(item)}</td></tr>}
              </React.Fragment>;
            })}{linhas.length===0&&<tr><td colSpan={11}>Nenhuma sugestão encontrada para os filtros selecionados.</td></tr>}</tbody>
          </table>
        </div>
        <button className="page-nav page-nav-right" onClick={() => carregar(offset + tamanhoPagina)} disabled={loading || offset + linhas.length >= totalLinhas}><ChevronRight size={22}/></button>
      </div>
    );
  }

  function renderAmbiguos() {
    const grupos = new Map<string, ConciliacaoLinha[]>();
    for (const item of linhas) {
      const chave = item.venda_interdata_id || item.id;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave)!.push(item);
    }
    return (
      <div className="ambiguidade-lista" ref={tabelaRef}>
        {[...grupos.entries()].map(([chave, candidatos]) => {
          const base = candidatos[0];
          const qtdInformada = Math.max(candidatos.length, Number(base.quantidade_candidatos_equivalentes || 0));
          return <section className="ambiguidade-grupo" key={chave}>
            <div className="ambiguidade-header">
              <div><span className="ambiguidade-label">Revisão necessária</span><h3>Venda ERP · {dataHoraVenda(base.venda_interdata)} · {formatarMoedaBrasil(base.venda_interdata?.valor_bruto)}</h3><p>Encontramos {qtdInformada} possível(is) correspondência(s). O sistema não conciliou automaticamente para evitar uma associação incorreta.</p></div>
              <div className="ambiguidade-erp-resumo"><RenderErpLogo valor={nomeErpVenda(base.venda_interdata)} /><span>Loja {estabelecimentoVenda(base.venda_interdata)}</span><span>NSU {valorTabela(base.venda_interdata?.nsu)}</span></div>
            </div>
            {base.observacoes && <div className="conciliacao-ambiguidade-motivo"><strong>Por que está ambíguo?</strong><span>{base.observacoes}</span></div>}
            <div className="table-wrap"><table className="ambiguidade-candidatos-table"><thead><tr><th>Adquirente</th><th>Data / hora</th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.valor_bruto)} title="Valor bruto"><span className="coluna-header-texto">Valor bruto</span></th><th>Diferença</th><th>Confiança</th><th>Por que pode corresponder</th><th>Ações</th></tr></thead><tbody>{candidatos.map((item) => {
              const expandida = expandidas.has(item.id);
              return <React.Fragment key={item.id}><tr><td>{item.venda_adquirente ? <RenderAdquirenteLogo valor={item.venda_adquirente.adquirente}/> : '-'}</td><td>{dataHoraVenda(item.venda_adquirente)}</td><td>{formatarMoedaBrasil(item.venda_adquirente?.valor_bruto)}</td><td><div className="difference-stack"><span>{formatarMoedaBrasil(item.diferenca_valor)}</span><small>{diferencaHorario(item)}</small></div></td><td><span className={`confianca-badge confianca-${(item.confianca||'BAIXA').toLowerCase()}`}>{rotuloConfianca(item)} · {valorTabela(item.score)}</span></td><td><div className="match-explanation"><strong>{tipoMatchAmigavel(item.tipo_match)}</strong><small>{criteriosAmigaveis(item)}</small></div></td><td><div className="inline-actions"><button className="secondary" onClick={()=>alternarDetalhes(item)}>{expandida?'Fechar':'Comparar'}</button><button onClick={()=>setAcaoModal({acao:'confirmar',ids:[item.id]})}>Selecionar e confirmar</button></div></td></tr>{expandida&&<tr className="conciliacao-detail-row"><td colSpan={7}>{renderComparacaoDetalhada(item)}</td></tr>}</React.Fragment>;
            })}</tbody></table></div>
          </section>;
        })}
        {linhas.length===0&&<div className="empty-state"><strong>Nenhuma ambiguidade encontrada.</strong><span>Não há itens ambíguos para os filtros selecionados.</span></div>}
        <div className="ambiguidade-pagination"><button className="secondary" onClick={()=>carregar(Math.max(0,offset-tamanhoPagina))} disabled={loading||offset===0}>Anterior</button><span>Exibindo {totalLinhas===0?0:offset+1}–{Math.min(offset+linhas.length,totalLinhas)} de {totalLinhas}</span><button className="secondary" onClick={()=>carregar(offset+tamanhoPagina)} disabled={loading||offset+linhas.length>=totalLinhas}>Próxima</button></div>
      </div>
    );
  }

  function renderHistorico() {
    return (
      <div className="table-pagination-shell" ref={tabelaRef}>
        <button className="page-nav page-nav-left" onClick={() => carregar(Math.max(0, offset - tamanhoPagina))} disabled={offset === 0 || loading}><ChevronLeft size={22}/></button>
        <div className="table-wrap db-data-table">
          <table className="conciliacao-historico-table">
            <thead><tr><th><input type="checkbox" checked={linhas.length>0&&linhas.every(i=>selecionadas.has(i.id))} onChange={alternarSelecaoVisiveis} aria-label="Selecionar todas as conciliações visíveis"/></th><th>ERP</th><th>Adquirente</th><th>Data / hora</th><th className="coluna-limitavel" style={estiloLarguraColuna(LARGURAS_COLUNAS.conciliacoes.valor_bruto)} title="Valor bruto"><span className="coluna-header-texto">Valor bruto</span></th><th>Como foi conciliado</th><th>Confiança</th><th>Conciliado em</th><th>Ações</th></tr></thead>
            <tbody>
              {linhas.map(item=><tr key={item.id} className="conciliacao-historico-row">
                <td><input type="checkbox" checked={selecionadas.has(item.id)} onChange={()=>alternarSelecao(item.id)} aria-label="Selecionar conciliação"/></td>
                <td><RenderErpLogo valor={nomeErpVenda(item.venda_interdata)} /></td>
                <td>{item.venda_adquirente?<RenderAdquirenteLogo valor={item.venda_adquirente.adquirente}/>: '-'}</td>
                <td>{dataHoraVenda(item.venda_interdata)}</td>
                <td>{formatarMoedaBrasil(item.venda_interdata?.valor_bruto)}</td>
                <td title={criteriosAmigaveis(item)}><div className="match-explanation compact"><strong>{comoFoiConciliado(item)}</strong></div></td>
                <td><span className={`confianca-badge confianca-${(item.confianca||'BAIXA').toLowerCase()}`}>{rotuloConfianca(item)} · {valorTabela(item.score)}</span></td>
                <td>{formatarDataHoraConciliacao(item.data_conciliacao)}</td>
                <td><div className="inline-actions"><button className="secondary" onClick={()=>abrirDetalhes(item.id)}>Ver detalhes</button></div></td>
              </tr>)}
              {linhas.length===0&&<tr><td colSpan={9}>Nenhuma conciliação encontrada para os filtros selecionados.</td></tr>}
            </tbody>
          </table>
        </div>
        <button className="page-nav page-nav-right" onClick={() => carregar(offset + tamanhoPagina)} disabled={loading || offset + linhas.length >= totalLinhas}><ChevronRight size={22}/></button>
      </div>
    );
  }

  useEffect(() => {
    void (async () => {
      const hoje = formatarDataIsoLocal(new Date());
      const filtrosHoje = { estabelecimento:'', adquirente:'', data_inicial:hoje, data_final:hoje };
      setFiltros(filtrosHoje);
      await carregarInicializacaoConciliacoes(filtrosHoje);
      // A abertura/refresh da tela carrega somente os totalizadores e opções de filtro.
      // As tabelas só consultam dados após o usuário clicar em Aplicar.
      setLinhas([]);
      setManualErp([]);
      setManualAdq([]);
    })();
  }, []);

  const [tituloAtual, contextoAtual] = tituloStatus();

  return (
    <section className="conciliacoes-page">
      <div className="page-title-row conciliacoes-heading">
        <div>
          <h1>Central de Conciliações</h1>
          <p className="muted">Acompanhe o que já foi conciliado e revise somente o que precisa de atenção.</p>
        </div>
        <div className="conciliacao-top-actions">
          <button onClick={executarConciliacao} disabled={loading}>{loading ? 'Processando...' : 'Executar conciliação automática'}</button>
          <details className="conciliacao-actions-menu">
            <summary>Outras ações <ChevronDown size={15}/></summary>
            <div className="conciliacao-actions-popover">
              <button className="secondary" onClick={simularConciliacao} disabled={loading}><strong>Simular conciliação</strong><span>Analisa possíveis correspondências sem alterar dados.</span></button>
              <button className="secondary" onClick={abrirConciliacaoManual} disabled={loading}><strong>Conciliação manual</strong><span>Abre as duas filas em modo de tela cheia.</span></button>
            </div>
          </details>
        </div>
      </div>
      {message && <p className="message">{message}</p>}

      <div className="conciliacao-control-bar">
        <div className="conciliacao-kpis">
          {([
            ['PENDENTE','Não conciliados',contadores.pendente||0,'Vendas do ERP ainda sem correspondente'],
            ['SUGERIDO','Sugeridos',contadores.sugerido||0,'Correspondências que precisam de confirmação'],
            ['AMBIGUO','Ambíguos',contadores.ambiguo||0,'Mais de uma correspondência possível'],
            ['CONCILIADO','Conciliados',contadores.conciliado||0,'Correspondências já confirmadas'],
          ] as const).map(([chave,rotulo,total,descricao])=><button key={chave} className={`conciliacao-kpi ${status===chave?'active':''}`} onClick={()=>{setStatus(chave);setLinhas([]);setTotalLinhas(0);setManualErp([]);setManualAdq([]);setManualTotalErp(0);setManualTotalAdq(0);}}><span className="kpi-copy"><strong>{rotulo}</strong><small>{descricao}</small></span><b>{total.toLocaleString('pt-BR')}</b></button>)}
        </div>

        <div className="conciliacao-filter-area">
          <div className="panel report-filters conciliacao-main-filters">
            <div><label>Data inicial</label><input type="date" value={filtros.data_inicial} onChange={e=>setFiltros({...filtros,data_inicial:e.target.value})}/></div>
            <div><label>Data final</label><input type="date" value={filtros.data_final} onChange={e=>setFiltros({...filtros,data_final:e.target.value})}/></div>
            <div><label>Estabelecimento</label><select value={filtros.estabelecimento} onChange={e=>setFiltros({...filtros,estabelecimento:e.target.value})}><option value="">Todos</option>{opcoesEstabelecimentos.map(item=><option key={item} value={item}>{item}</option>)}</select></div>
            <div><label>Adquirente</label><select value={filtros.adquirente} onChange={e=>setFiltros({...filtros,adquirente:e.target.value})}><option value="">Todas</option>{opcoesAdquirentes.map(item=><option key={item} value={item}>{item}</option>)}</select></div>
            <div className="report-filter-actions"><button onClick={()=>aplicarFiltros()} disabled={loading}>{loading?'Carregando...':'Aplicar'}</button><button className="secondary" onClick={limparFiltros} disabled={loading}>Limpar</button></div>
          </div>
        </div>
      </div>

      <div className="panel conciliacoes-panel redesigned">
        {/*<div className="db-title-row conciliacao-section-title"><div><h2>{tituloAtual}</h2><p className="muted conciliacoes-contexto">{contextoAtual}</p></div><span className="muted">{status==='PENDENTE' ? `${manualTotalErp.toLocaleString('pt-BR')} ERP · ${manualTotalAdq.toLocaleString('pt-BR')} adquirente(s) pendente(s)` : `Exibindo ${totalLinhas === 0 ? 0 : offset + 1}–${Math.min(offset + linhas.length, totalLinhas)} de ${totalLinhas}`}</span></div>*/}

        {selecionadas.size > 0 && status === 'SUGERIDO' && <div className="conciliacao-lote"><strong>{selecionadas.size} sugestão(ões) selecionada(s)</strong><span className="muted">Confirme somente itens que você já revisou.</span><button onClick={()=>setAcaoModal({acao:'confirmar',ids:[...selecionadas]})}>Confirmar em lote</button><button className="secondary" onClick={()=>setSelecionadas(new Set())}>Limpar seleção</button></div>}
        {selecionadas.size > 0 && status === 'CONCILIADO' && <div className="conciliacao-lote"><strong>{selecionadas.size} conciliação(ões) selecionada(s)</strong><span className="muted">O desfazimento exige motivo e fica registrado na auditoria.</span><button className="desfazer-confirmar" onClick={()=>setAcaoModal({acao:'desfazer',ids:[...selecionadas]})}>Desfazer em lote</button><button className="secondary" onClick={()=>setSelecionadas(new Set())}>Limpar seleção</button></div>}

        {status === 'PENDENTE' && <div className="conciliacao-pendente-workspace">{/*<div className="manual-explanation"><strong>Como usar</strong><span>Selecione uma venda do ERP e a transação correspondente da adquirente. Confira os dados e clique em “Conciliar selecionados”.</span></div>*/}{renderManualWorkspace(false)}{/*<div className="manual-fullscreen-trigger"><button className="secondary" onClick={abrirConciliacaoManual}>⛶</button></div>*/}</div>}
        {status === 'SUGERIDO' && renderSugestoes()}
        {status === 'AMBIGUO' && renderAmbiguos()}
        {status === 'CONCILIADO' && renderHistorico()}
      </div>

      {manualAberta && <div className="manual-conciliacao-overlay"><div className="manual-conciliacao-shell redesigned-fullscreen"><div className="manual-conciliacao-header"><div><h2>Conciliação manual ERP × Adquirente</h2><p className="muted">Duas filas lado a lado para localizar, comparar e vincular os registros corretos.</p></div></div>{renderManualWorkspace(true)}</div></div>}

      {detalhes && <div className="modal-backdrop" onMouseDown={()=>setDetalhes(null)}>
        <div className="conciliacao-modal" onMouseDown={e=>e.stopPropagation()}>
          <div className="modal-title"><h2>Detalhes da conciliação</h2><button className="secondary" onClick={()=>setDetalhes(null)}>Fechar</button></div>
          <div className="detalhes-grade"><div><span>Status</span><strong>{detalhes.conciliacao.status}</strong></div><div><span>Confiança</span><strong>{rotuloConfianca(detalhes.conciliacao)} · {detalhes.conciliacao.score}</strong></div><div><span>Tipo</span><strong>{tipoMatchAmigavel(detalhes.conciliacao.tipo_match)}</strong></div><div><span>Critérios</span><strong>{criteriosAmigaveis(detalhes.conciliacao)}</strong></div></div>
          {renderComparacaoDetalhada(detalhes.conciliacao)}
          <h3>Histórico de ações</h3>
          <div className="historico-lista">{detalhes.historico.length?detalhes.historico.map((h:any)=><div key={h.id}><strong>{h.acao}</strong><span>{h.usuario_nome||'Sistema'} · {new Date(h.criado_em).toLocaleString('pt-BR')}</span><p>{h.motivo}</p></div>):<p className="muted">Nenhuma ação manual registrada.</p>}</div>
          {detalhes.conciliacao.status === 'CONCILIADO' && <div className="conciliacao-modal-actions"><button className="desfazer-confirmar" onClick={()=>{const id=detalhes.conciliacao.id;setDetalhes(null);setAcaoModal({acao:'desfazer',ids:[id]})}}>Desfazer conciliação</button></div>}
        </div>
      </div>}
      {acaoModal && <div className="modal-backdrop"><div className="conciliacao-modal acao"><h2>{acaoModal.acao==='confirmar'?'Confirmar conciliação':'Desfazer conciliação'}</h2><p>Esta ação afetará {acaoModal.ids.length} item(ns). Informe o motivo para manter a auditoria completa.</p><textarea rows={4} value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Descreva o motivo da decisão" autoFocus/><div className="button-row"><button className="secondary" onClick={()=>{setAcaoModal(null);setMotivo('')}}>Cancelar</button><button disabled={motivo.trim().length<3||loading} onClick={()=>acaoConciliacao(acaoModal.ids,acaoModal.acao,motivo)}>{loading?'Processando...':'Confirmar ação'}</button></div></div></div>}
    </section>
  );
}

function App() {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(() => {
    const token = sessionStorage.getItem('erp_auth_token');
    if (!token) { sessionStorage.removeItem('erp_auth_user'); return null; }
    try { return JSON.parse(sessionStorage.getItem('erp_auth_user') || 'null'); }
    catch { sessionStorage.removeItem('erp_auth_token'); sessionStorage.removeItem('erp_auth_user'); return null; }
  });
  const [loginForm, setLoginForm] = useState({ login: '', senha: '' }); const [erro, setErro] = useState(''); const [carregando, setCarregando] = useState(false);
  function sair() { sessionStorage.removeItem('erp_auth_token'); sessionStorage.removeItem('erp_auth_user'); setUsuario(null); }
  useEffect(() => { window.addEventListener('erp:sessao-expirada', sair); return () => window.removeEventListener('erp:sessao-expirada', sair); }, []);
  async function entrar(event: React.FormEvent) { event.preventDefault(); setCarregando(true); setErro(''); try { const response = await publicApiFetch(`${API_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginForm) }); const body = await response.json(); if (!response.ok) throw new Error(body.mensagem || 'Não foi possível entrar.'); sessionStorage.setItem('erp_auth_token', body.token); sessionStorage.setItem('erp_auth_user', JSON.stringify(body.usuario)); setUsuario(body.usuario); } catch (error) { setErro(error instanceof Error ? error.message : 'Erro ao entrar.'); } finally { setCarregando(false); } }
  if (usuario?.trocar_senha) return <TrocarSenhaInicial usuario={usuario} concluir={(atualizado) => { sessionStorage.setItem('erp_auth_user', JSON.stringify(atualizado)); setUsuario(atualizado); }} sair={sair} />;
  if (usuario) return <Sistema usuario={usuario} sair={sair} />;
  const loginPage = <div className="login-page"><form className="login-card" onSubmit={entrar}><img src={logoTigre} alt="Supermercado Tigre" /><h1>ERPxADQUIRENTE</h1><p className="muted">Acesso seguro ao sistema de conciliação</p>{erro && <div className="notice danger">{erro}</div>}<label>Login<input autoFocus value={loginForm.login} onChange={(e) => setLoginForm({ ...loginForm, login: e.target.value })} required /></label><label>Senha<input type="password" value={loginForm.senha} onChange={(e) => setLoginForm({ ...loginForm, senha: e.target.value })} required /></label><button className="button primary" disabled={carregando}>{carregando ? 'Entrando…' : 'Entrar'}</button></form></div>;
  return <Routes><Route path="/login" element={loginPage}/><Route path="*" element={<Navigate to="/login" replace />}/></Routes>;
}

function TrocarSenhaInicial({ usuario, concluir, sair }: { usuario: UsuarioSessao; concluir: (usuario: UsuarioSessao) => void; sair: () => void }) {
  const [form, setForm] = useState({ atual: '', nova: '', confirmar: '' }); const [erro, setErro] = useState(''); const [salvando, setSalvando] = useState(false);
  async function enviar(event: React.FormEvent) { event.preventDefault(); if (form.nova !== form.confirmar) return setErro('A confirmação não corresponde à nova senha.'); setSalvando(true); setErro(''); try { const response = await apiFetch(`${API_URL}/api/auth/alterar-senha`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha_atual: form.atual, nova_senha: form.nova }) }); const body = await response.json(); if (!response.ok) throw new Error(body.mensagem || 'Não foi possível alterar a senha.'); concluir({ ...usuario, trocar_senha: false }); } catch (error) { setErro(error instanceof Error ? error.message : 'Erro ao alterar senha.'); } finally { setSalvando(false); } }
  return <div className="login-page"><form className="login-card" onSubmit={enviar}><img src={logoTigre} alt="Supermercado Tigre" /><h1>Crie uma nova senha</h1><p className="muted">Por segurança, a senha temporária precisa ser substituída antes de acessar o sistema. Use pelo menos 8 caracteres.</p>{erro && <div className="notice danger">{erro}</div>}<label>Senha temporária<input type="password" value={form.atual} onChange={(e) => setForm({ ...form, atual: e.target.value })} required /></label><label>Nova senha<input type="password" minLength={8} value={form.nova} onChange={(e) => setForm({ ...form, nova: e.target.value })} required /></label><label>Confirmar nova senha<input type="password" minLength={8} value={form.confirmar} onChange={(e) => setForm({ ...form, confirmar: e.target.value })} required /></label><button className="button primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Alterar senha e continuar'}</button><button type="button" className="button secondary" onClick={sair}>Cancelar</button></form></div>;
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>);
