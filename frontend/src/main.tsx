import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, LayoutDashboard, Users, RefreshCcw, Database, SearchCheck, AlertTriangle, Table2, Columns3, ReceiptText, Trash2, PlusCircle, CreditCard, Pencil, XCircle, Server, CloudDownload, ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react';
import { theme } from './lib/theme';
import logoTigre from './assets/logo-tigre.png';
import cieloLogo from './assets/payment-logos/cielo.png';
import sicrediLogo from './assets/payment-logos/sicredi.png';
import sipagLogo from './assets/payment-logos/sipag.png';
import sicoobLogo from './assets/payment-logos/sicoob.png';
import aleloLogo from './assets/payment-logos/alelo.png';
import cabalLogo from './assets/payment-logos/cabal.png';
import convcardLogo from './assets/payment-logos/convcard.png';
import eloLogo from './assets/payment-logos/elo.png';
import mastercardLogo from './assets/payment-logos/mastercard.png';
import pixLogo from './assets/payment-logos/pix.png';
import sodexoLogo from './assets/payment-logos/sodexo.png';
import ticketLogo from './assets/payment-logos/ticket.png';
import visaLogo from './assets/payment-logos/visa.png';
import voucherLogo from './assets/payment-logos/voucher.png';
import vrLogo from './assets/payment-logos/vr.png';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3333';

type Importacao = {
  id: string;
  nome_arquivo_original: string;
  tamanho_bytes: string | number;
  origem_detectada: string | null;
  layout_detectado: string | null;
  status_importacao: string;
  quantidade_registros: number;
  quantidade_processados: number;
  quantidade_erros: number;
  hash_arquivo?: string;
  data_importacao: string;
  mensagem_erro?: string | null;
  caminho_arquivo?: string | null;
  nome_arquivo_salvo?: string | null;
  data_atualizacao?: string | null;
};

type ImportacoesPoll = {
  timestamp: string;
  fila_importacao?: {
    rodando: boolean;
    modo?: string;
    pendentes: number;
    atual?: { importacao_id: string; nome_arquivo_original: string; origem_fila: string } | null;
  };
  sftp?: Record<string, unknown>;
  pastas_importacao?: Record<string, unknown>;
  resumo_importacoes?: Record<string, number> | null;
  importacoes?: Importacao[];
};

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

function formatBytes(value: string | number) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    RECEBIDO: 'Recebido',
    CLASSIFICANDO: 'Classificando',
    CLASSIFICADO: 'Classificado',
    PROCESSANDO: 'Processando',
    PROCESSADO: 'Processado',
    ERRO: 'Erro',
    LAYOUT_DESCONHECIDO: 'Layout desconhecido',
    ARQUIVO_DUPLICADO: 'Arquivo duplicado',
    EXTENSAO_BLOQUEADA: 'Extensão bloqueada',
    PROCESSANDO_FILA: 'Na fila',
    RECUPERADO_REENFILEIRADO: 'Recuperado',
    ENFILEIRADO: 'Enfileirado',
  };
  return map[status] || status;
}


const adquirenteLogoMap: Record<string, string> = {
  CIELO: cieloLogo,
  SIPAG: sipagLogo,
  SICOOB: sicoobLogo,
  SICREDI: sicrediLogo,
};

const bandeiraLogoMap: Record<string, string> = {
  PIX: pixLogo,
  VISA: visaLogo,
  MASTERCARD: mastercardLogo,
  MASTER: mastercardLogo,
  ELO: eloLogo,
  ALELO: aleloLogo,
  CABAL: cabalLogo,
  SODEXO: sodexoLogo,
  TICKET: ticketLogo,
  VR: vrLogo,
  VOUCHER: voucherLogo,
  CONVCARD: convcardLogo,
  'CONV CARD': convcardLogo,
  CONVENIO: convcardLogo,
  CONVÊNIO: convcardLogo,
};

function normalizarChaveLogo(valor: unknown) {
  return valorTabela(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

function RenderAdquirenteLogo({ valor }: { valor: unknown }) {
  const texto = valorTabela(valor);
  const chave = normalizarChaveLogo(texto);
  const logo = adquirenteLogoMap[chave];
  if (!logo || texto === '-') return <span title={texto}>{texto}</span>;
  return (
    <span className="logo-value logo-value-adquirente" title={texto}>
      <img src={logo} alt={texto} />
    </span>
  );
}

function RenderBandeiraLogo({ valor }: { valor: unknown }) {
  const texto = valorTabela(valor);
  const chave = normalizarChaveLogo(texto);
  const logo = bandeiraLogoMap[chave];
  if (!logo || texto === '-') return <span title={texto}>{texto}</span>;
  return (
    <span className="logo-value logo-value-bandeira" title={texto}>
      <img src={logo} alt={texto} />
    </span>
  );
}

function valorTabela(valor: unknown) {
  if (valor === null || valor === undefined || valor === '') return '-';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}


function formatarMoedaBrasil(valor: unknown) {
  if (valor === null || valor === undefined || valor === '') return '-';
  if (typeof valor === 'object') return valorTabela(valor);

  let texto = String(valor).trim();
  if (!texto || texto === '-') return '-';

  const negativo = /^-/.test(texto) || /\-$/.test(texto);
  texto = texto.replace(/[^\d,.-]/g, '');

  if (!texto || texto === '-' || texto === ',' || texto === '.') return '-';

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) {
    // Padrão BR recebido como texto: 1.234,56
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    // Decimal com vírgula: 1234,56
    texto = texto.replace(',', '.');
  } else if ((texto.match(/\./g) || []).length > 1) {
    // Pontos como separador de milhar: 1.234.567
    texto = texto.replace(/\./g, '');
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero)) return valorTabela(valor);

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(negativo ? -Math.abs(numero) : numero);
}

const COLUNAS_MOEDA = new Set(['valor_bruto', 'valor_taxa', 'valor_liquido']);
const COLUNAS_PERCENTUAL = new Set(['percentual_taxa']);

function primeiroValor(...valores: unknown[]) {
  for (const valor of valores) {
    if (valor !== null && valor !== undefined && String(valor).trim() !== '') return valor;
  }
  return '';
}

function normalizarData(data?: unknown) {
  const dataTexto = valorTabela(data).trim();
  if (dataTexto === '-') return '-';

  const somenteDigitos = dataTexto.replace(/\D/g, '');
  if (/^\d{8}$/.test(somenteDigitos)) {
    const inicio = Number(somenteDigitos.slice(0, 2));
    const meio = Number(somenteDigitos.slice(2, 4));
    const fim = Number(somenteDigitos.slice(4, 8));

    // ddmmaaaa, exemplo 15032026 -> 15/03/2026
    if (inicio >= 1 && inicio <= 31 && meio >= 1 && meio <= 12 && fim >= 1900) {
      return `${somenteDigitos.slice(0, 2)}/${somenteDigitos.slice(2, 4)}/${somenteDigitos.slice(4, 8)}`;
    }

    // aaaammdd, exemplo 20260315 -> 15/03/2026
    const ano = Number(somenteDigitos.slice(0, 4));
    const mes = Number(somenteDigitos.slice(4, 6));
    const dia = Number(somenteDigitos.slice(6, 8));
    if (ano >= 1900 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      return `${somenteDigitos.slice(6, 8)}/${somenteDigitos.slice(4, 6)}/${somenteDigitos.slice(0, 4)}`;
    }
  }

  const iso = dataTexto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const separado = dataTexto.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})$/);
  if (separado) {
    const dia = separado[1].padStart(2, '0');
    const mes = separado[2].padStart(2, '0');
    const ano = separado[3].length === 2 ? `20${separado[3]}` : separado[3];
    return `${dia}/${mes}/${ano}`;
  }

  return dataTexto;
}

function normalizarDataHora(data?: unknown, hora?: unknown) {
  const dataTexto = normalizarData(data);
  const horaTexto = valorTabela(hora).trim();
  if (dataTexto === '-' && horaTexto === '-') return '-';
  if (dataTexto === '-') return horaTexto;
  if (horaTexto === '-') return dataTexto;
  const horaJaContemData = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(horaTexto);
  return horaJaContemData ? horaTexto : `${dataTexto} ${horaTexto}`;
}

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
  const caminho = item.caminho_arquivo || '';
  if (caminho.includes('/erro/duplicidades/')) return 'erro/duplicidades';
  if (caminho.includes('/erro/layout_desconhecido/')) return 'erro/layout_desconhecido';
  if (caminho.includes('/erro/falha_importacao/')) return 'erro/falha_importacao';
  if (caminho.includes('/erro/extensao_bloqueada/')) return 'erro/extensao_bloqueada';
  if (caminho.includes('/processados/')) return 'processados';
  if (caminho.includes('/processando/')) return 'processando';
  if (caminho.includes('/entrada/')) return 'entrada';
  return '-';
}

function detalheImportacao(item: Importacao) {
  if (item.status_importacao === 'ARQUIVO_DUPLICADO') return item.mensagem_erro || 'Duplicidade detectada por hash.';
  if (item.status_importacao === 'LAYOUT_DESCONHECIDO') return item.mensagem_erro || 'Layout não reconhecido pelos parsers configurados.';
  if (item.status_importacao === 'ERRO') return item.mensagem_erro || 'Falha técnica no processamento.';
  if (item.status_importacao === 'PROCESSADO') return `${item.quantidade_processados || 0} registro(s) gravado(s).`;
  return item.mensagem_erro || '-';
}

function App() {
  const [page, setPage] = useState(window.location.pathname || '/');

  useEffect(() => {
    window.history.replaceState(null, '', page);
  }, [page]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand brand-logo">
          <img src={logoTigre} alt="Supermercado Tigre" />
          <div>
            <strong>ERPxADQUIRENTE</strong>
            <span>v{theme.version}</span>
          </div>
        </div>
        <button className={page === '/' ? 'active' : ''} onClick={() => setPage('/')}><LayoutDashboard size={18}/> Dashboard</button>
        <button className={page === '/imports' ? 'active' : ''} onClick={() => setPage('/imports')}><Upload size={18}/> Importações</button>
        <button className={page === '/erp-vendas' ? 'active' : ''} onClick={() => setPage('/erp-vendas')}><ReceiptText size={18}/> Vendas ERP</button>
        <button className={page === '/adquirentes-vendas' ? 'active' : ''} onClick={() => setPage('/adquirentes-vendas')}><CreditCard size={18}/> Vendas Adquirentes</button>
        <button className={page === '/relatorios-adquirentes' ? 'active' : ''} onClick={() => setPage('/relatorios-adquirentes')}><BarChart3 size={18}/> Relatórios Adquirentes</button>
        <button className={page === '/sftp' ? 'active' : ''} onClick={() => setPage('/sftp')}><Server size={18}/> SFTP EDI</button>
        <button className={page === '/banco' ? 'active' : ''} onClick={() => setPage('/banco')}><Table2 size={18}/> Banco de Dados</button>
        <button className={page === '/users' ? 'active' : ''} onClick={() => setPage('/users')}><Users size={18}/> Usuários</button>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <div className="topbar-title">Sistema de Conciliação ERP x ADQUIRENTES</div>
            <span>INTERDATA • SIPAG • SICOOB • CIELO • SICREDI • PIX • CONVCARD</span>
          </div>
          <div className="topbar-actions">Tema Tigre Dark Premium</div>
        </header>
        <div className="page">
          {page === '/imports' ? <ImportsPage /> : page === '/erp-vendas' ? <VendasErpPage /> : page === '/adquirentes-vendas' ? <VendasAdquirentesPage /> : page === '/relatorios-adquirentes' ? <RelatoriosAdquirentesPage /> : page === '/sftp' ? <SftpPage /> : page === '/banco' ? <BancoDadosPage /> : page === '/users' ? <UsersPage /> : <Dashboard />}
        </div>
      </main>
    </div>
  );
}

function Dashboard() {
  const cards = [
    { label: 'Importações', value: 'Pipeline único', icon: Database },
    { label: 'Banco', value: 'Explorador', icon: Table2 },
    { label: 'Classificador', value: 'Automático', icon: SearchCheck },
    { label: 'Status', value: `v${theme.version}`, icon: AlertTriangle },
  ];

  return (
    <section>
      <h1>Dashboard</h1>
      <p className="muted">Painel inicial do ERPxADQUIRENTE com base preparada para importações, classificação automática e inspeção das tabelas do sistema.</p>
      <div className="cards">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div className="card" key={card.label}>
              <div className="card-icon"><Icon size={22}/></div>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </div>
          );
        })}
      </div>
      <div className="panel hero-panel">
        <h2>Versão {theme.version}</h2>
        <p>
          Esta versão adiciona o Layout Interdata e o parser SIPAG Layout 2.0, preserva os dados brutos importados e usa a tabela conversoes apenas para exibição padronizada no frontend.
        </p>
      </div>
    </section>
  );
}

function ImportsPage() {
  const [imports, setImports] = useState<Importacao[]>([]);
  const [poll, setPoll] = useState<ImportacoesPoll | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState('');
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  async function loadImports() {
    try {
      const response = await fetch(`${API_URL}/api/importacoes/poll`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível carregar as importações. Verifique se o backend está online.');
      const data: ImportacoesPoll = await response.json();
      setPoll(data);
      if (Array.isArray(data.importacoes)) setImports(data.importacoes);
      setLastUpdate(data.timestamp || new Date().toISOString());
    } catch (error) {
      try {
        const response = await fetch(`${API_URL}/api/importacoes`, { cache: 'no-store' });
        const data = await response.json();
        setImports(data);
        setLastUpdate(new Date().toISOString());
      } catch {
        setMessage(error instanceof Error ? error.message : 'Erro ao carregar importações.');
      }
    }
  }

  useEffect(() => {
    loadImports();
    const timer = setInterval(loadImports, 2000);
    return () => clearInterval(timer);
  }, []);


  async function recuperarProcessando() {
    setRecovering(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/importacoes/recovery/processando`, {
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

  async function uploadFile() {
    if (files.length === 0) return;
    setUploading(true);
    setMessage('');
    try {
      const resultados: string[] = [];
      for (const arquivo of files) {
        const formData = new FormData();
        formData.append('file', arquivo);
        const response = await fetch(`${API_URL}/api/importacoes/upload`, { method: 'POST', body: formData });
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

  return (
    <section>
      {/*<h1>Importações</h1>*/}
      <p className="muted">Acompanhamento em tempo real do pipeline: entrada → fila/processando → processados ou erro/duplicidades, erro/layout_desconhecido e erro/falha_importacao.</p>

      <div className="cards import-status-cards">
        <div className="card">{<span>Total:</span>}<strong>{stats.total}</strong></div>
        <div className="card"><span>Recebidos/Fila:</span><strong>{stats.recebidos + (poll?.fila_importacao?.pendentes || 0)}</strong></div>
        <div className="card warning"><span>Em processamento:</span><strong>{stats.emAndamento}</strong></div>
        <div className="card success"><span>Processados:</span><strong>{stats.processados}</strong></div>
        <div className="card warning"><span>Duplicados:</span><strong>{stats.duplicados}</strong></div>
        <div className="card warning"><span>Layout desconhecido:</span><strong>{stats.desconhecidos}</strong></div>
        <div className="card danger"><span>Falhas:</span><strong>{stats.erros}</strong></div>
      </div>

      <div className="panel live-panel">
        {/*<div>
          <h2>Status em tempo real</h2>
          <p className="muted">Atualização automática a cada 2 segundos. Última leitura: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString('pt-BR') : '-'}</p>
        </div>*/}
        <div className="live-grid">
          <span><strong>Trabalhos:</strong> {poll?.fila_importacao?.rodando ? 'processando' : 'aguardando'}</span>
          <span><strong>Pendentes:</strong> {poll?.fila_importacao?.pendentes ?? 0}</span>
          <span><strong>Atual:</strong> {poll?.fila_importacao?.atual?.nome_arquivo_original || '-'}</span>
          <span><strong>SFTP:</strong> {poll?.sftp ? 'monitorado' : 'sem dados'}</span>
          <span><strong>Presos em processando/:</strong> {String(poll?.pastas_importacao?.processando ?? 0)}</span>
        </div>
      </div>

      <div className="panel upload-panel">
        <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        <button onClick={uploadFile} disabled={files.length === 0 || uploading}><Upload size={16}/>{uploading ? 'Enviando...' : files.length > 1 ? `Enviar ${files.length} arquivos` : 'Enviar arquivo'}</button>
        <button className="secondary" onClick={loadImports}><RefreshCcw size={16}/> Atualizar</button>
        {/*<button className="secondary" onClick={recuperarProcessando} disabled={recovering}><RefreshCcw size={16}/>{recovering ? 'Recuperando...' : 'Recuperar próximos 50'}</button>*/}
        {files.length > 0 && <p className="muted">Selecionados: {files.map((arquivo) => arquivo.name).join(', ')}</p>}
        {message && <p className="message">{message}</p>}
      </div>

      <div className="panel imports-table-panel">
        <h2>Histórico de importações</h2>
        <p className="muted">Cada linha mostra o status mais recente salvo pelo backend, a pasta física de destino, contadores de registros e detalhes de erro quando houver.</p>
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
              </tr>
            </thead>
            <tbody>
              {imports.map((item) => (
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
                </tr>
              ))}
              {imports.length === 0 && <tr><td colSpan={11}>Nenhum arquivo importado ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}


type VendaErp = {
  id: string;
  importacao_id: string;
  numero_linha: number;
  data_venda?: string;
  hora_venda?: string;
  terminal?: string;
  nsu?: string;
  valor_bruto?: string;
  forma_pagamento?: string;
  forma_pagamento_original?: string;
  bandeira?: string;
  bandeira_original?: string;
  tipo_produto?: string;
  tipo_produto_original?: string;
  parcelas?: string;
  cnpj_estabelecimento?: string;
  id_venda_erp?: string;
  status_venda?: string;
  status_venda_original?: string;
  hash_linha: string;
  valores_exibicao?: Record<string, unknown>;
};

type VendaErpColuna = 'erp' | 'data_venda' | 'hora_venda_exibicao' | 'valor_bruto' | 'tipo_produto' | 'modalidade' | 'bandeira' | 'parcelas' | 'status_venda' | 'nsu' | 'terminal';

const colunasVendasErp: { chave: VendaErpColuna; titulo: string }[] = [
  { chave: 'erp', titulo: 'ERP' },
  { chave: 'data_venda', titulo: 'Data venda' },
  { chave: 'hora_venda_exibicao', titulo: 'Hora venda' },
  { chave: 'valor_bruto', titulo: 'Valor bruto' },
  { chave: 'tipo_produto', titulo: 'Modalidade' },
  { chave: 'bandeira', titulo: 'Bandeira' },
  { chave: 'parcelas', titulo: 'Parcelas' },
  { chave: 'status_venda', titulo: 'Status venda' },
  { chave: 'nsu', titulo: 'NSU' },
  { chave: 'terminal', titulo: 'Terminal' },
];
/*console.log(colunasVendasErp)*/

function exibirVenda(venda: VendaErp, coluna: VendaErpColuna) {
  if (coluna === 'erp') return 'INTERDATA';
  if (coluna === 'hora_venda_exibicao') return valorTabela(primeiroValor(venda.hora_venda, venda.data_venda));
  if (coluna === 'modalidade') {
    const originalPreservado = venda.forma_pagamento_original;
    const valorAtual = venda.forma_pagamento;
    if (originalPreservado !== undefined && originalPreservado !== '' && originalPreservado !== valorAtual) {
      return <span title={`Valor original: ${valorTabela(originalPreservado)}`}>{valorTabela(valorAtual)}</span>;
    }
    return valorTabela(valorAtual);
  }
  if (coluna === 'bandeira') return <RenderBandeiraLogo valor={primeiroValor(venda.bandeira, venda.bandeira_original)} />;
  if (coluna === 'status_venda') {
    const valor = venda.status_venda || '';
    const title = valor === 'ATIVO' ? 'a confirmar na adquirente' : valorTabela(venda.status_venda_original || valor);
    return <span title={title}>{valorTabela(valor)}</span>;
  }
  if (COLUNAS_MOEDA.has(String(coluna))) return formatarMoedaBrasil(venda[coluna as keyof VendaErp]);

  const chaveOriginal = coluna;
  const originalPreservado = venda[`${String(chaveOriginal)}_original` as keyof VendaErp];
  const valorAtual = venda[chaveOriginal as keyof VendaErp];

  if (originalPreservado !== undefined && originalPreservado !== '' && originalPreservado !== valorAtual) {
    return <span title={`Valor original: ${valorTabela(originalPreservado)}`}>{valorTabela(valorAtual)}</span>;
  }

  return valorTabela(valorAtual);
}

const TAMANHO_PAGINA_VENDAS = 1000;

type OpcoesFiltrosVendas = {
  adquirentes: string[];
  modalidades: string[];
  bandeiras: string[];
  terminais: string[];
  status: string[];
};

type FiltrosListagemVendas = {
  data_inicio: string;
  data_fim: string;
  adquirente: string;
  forma_pagamento: string;
  modalidade: string;
  bandeira: string;
  terminal: string;
  status: string;
};

const opcoesFiltrosVazias: OpcoesFiltrosVendas = {
  adquirentes: [],
  modalidades: [],
  bandeiras: [],
  terminais: [],
  status: [],
};

function montarParamsListagemVendas(filtros: FiltrosListagemVendas, limite: number, offset: number) {
  const params = new URLSearchParams();
  params.set('limite', String(limite));
  params.set('offset', String(offset));

  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor) params.set(chave, valor);
  });

  return params;
}

function ajustarFiltrosListagemVendas(atual: FiltrosListagemVendas, chave: keyof FiltrosListagemVendas, valor: string) {
  const proximos: FiltrosListagemVendas = {
    ...atual,
    [chave]: valor,
  };

  if (chave === 'forma_pagamento') {
    if (valor === 'PIX') {
      proximos.modalidade = 'PIX';
      proximos.bandeira = '';
    }

    if (valor === 'CARTAO') {
      if (proximos.modalidade === 'PIX') proximos.modalidade = '';
      if (proximos.bandeira === 'PIX') proximos.bandeira = '';
    }

    if (!valor) {
      proximos.modalidade = '';
      proximos.bandeira = '';
    }
  }

  if (chave === 'modalidade') {
    if (valor === 'PIX') {
      proximos.forma_pagamento = 'PIX';
      proximos.bandeira = '';
    }

    if (valor && valor !== 'PIX' && proximos.forma_pagamento === 'PIX') {
      proximos.forma_pagamento = 'CARTAO';
      if (proximos.bandeira === 'PIX') proximos.bandeira = '';
    }
  }

  if (chave === 'bandeira' && valor === 'PIX') {
    proximos.forma_pagamento = 'PIX';
    proximos.modalidade = 'PIX';
  }

  return proximos;
}

function FiltrosVendas({
  filtros,
  opcoes,
  loading,
  exibirAdquirente = false,
  onChange,
  onFiltrar,
  onLimpar,
}: {
  filtros: FiltrosListagemVendas;
  opcoes: OpcoesFiltrosVendas;
  loading: boolean;
  exibirAdquirente?: boolean;
  onChange: (chave: keyof FiltrosListagemVendas, valor: string) => void;
  onFiltrar: () => void;
  onLimpar: () => void;
}) {
  const modalidadesDisponiveis = opcoes.modalidades.filter((item) => {
    const modalidade = String(item || '').toUpperCase();
    if (filtros.forma_pagamento === 'PIX') return modalidade === 'PIX';
    if (filtros.forma_pagamento === 'CARTAO') return modalidade !== 'PIX';
    return true;
  });

  const bandeirasDisponiveis = opcoes.bandeiras.filter((item) => {
    const bandeira = String(item || '').toUpperCase();
    if (filtros.forma_pagamento === 'CARTAO') return bandeira !== 'PIX';
    return true;
  });

  const bandeiraBloqueada = filtros.forma_pagamento === 'PIX';

  return (
    <div className="panel report-filters-erp">
      <div>
        <label>Data inicial</label>
        <input
          type="date"
          value={filtros.data_inicio}
          onChange={(event) => onChange('data_inicio', event.target.value)}
        />
      </div>

      <div>
        <label>Data final</label>
        <input
          type="date"
          value={filtros.data_fim}
          onChange={(event) => onChange('data_fim', event.target.value)}
        />
      </div>

      {exibirAdquirente && (
        <div>
          <label>Adquirente</label>
          <select
            value={filtros.adquirente}
            onChange={(event) => onChange('adquirente', event.target.value)}
          >
            <option value="">Todas</option>
            {opcoes.adquirentes.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label>Forma de pagamento</label>
        <select
          value={filtros.forma_pagamento}
          onChange={(event) => onChange('forma_pagamento', event.target.value)}
        >
          <option value="">Todas</option>
          <option value="CARTAO">CARTÃO</option>
          <option value="PIX">PIX</option>
        </select>
      </div>

      <div>
        <label>Modalidade</label>
        <select
          value={filtros.modalidade}
          onChange={(event) => onChange('modalidade', event.target.value)}
        >
          <option value="">Todas</option>
          {modalidadesDisponiveis.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>

      <div>
        <label>Bandeira</label>
        <select
          value={filtros.bandeira}
          onChange={(event) => onChange('bandeira', event.target.value)}
          disabled={bandeiraBloqueada}
          title={bandeiraBloqueada ? 'PIX não utiliza bandeira de cartão.' : undefined}
        >
          <option value="">{bandeiraBloqueada ? 'Não se aplica ao PIX' : 'Todas'}</option>
          {bandeirasDisponiveis.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>

      {/*<div>
        <label>Terminal</label>
        <select
          value={filtros.terminal}
          onChange={(event) => onChange('terminal', event.target.value)}
        >
          <option value="">Todos</option>
          {opcoes.terminais.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>

      <div>
        <label>Status</label>
        <select
          value={filtros.status}
          onChange={(event) => onChange('status', event.target.value)}
        >
          <option value="">Todos</option>
          {opcoes.status.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>*/}

      <div className="report-filter-actions">
        <button onClick={onFiltrar} disabled={loading}>{loading ? 'Carregando...' : 'Filtrar'}</button>
        <button className="secondary" onClick={onLimpar} disabled={loading}>Limpar</button>
      </div>
    </div>
  );
}

function VendasErpPage() {
  const [vendas, setVendas] = useState<VendaErp[]>([]);
  const [message, setMessage] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [opcoesFiltros, setOpcoesFiltros] = useState<OpcoesFiltrosVendas>(opcoesFiltrosVazias);
  const [filtros, setFiltros] = useState<FiltrosListagemVendas>(() => filtrosPadraoPeriodoAtual());

  async function carregarOpcoesFiltros() {
    try {
      const response = await fetch(`${API_URL}/api/vendas-erp/opcoes`);
      if (response.ok) setOpcoesFiltros(await response.json());
    } catch {
      // As opções são auxiliares; a tabela ainda pode carregar sem elas.
    }
  }

  async function carregarVendas(proximoOffset = offset, proximosFiltros = filtros) {
    setMessage('');
    setLoading(true);
    try {
      const params = montarParamsListagemVendas(proximosFiltros, TAMANHO_PAGINA_VENDAS, proximoOffset);
      const response = await fetch(`${API_URL}/api/vendas-erp?${params.toString()}`);
      if (!response.ok) throw new Error('Não foi possível carregar as vendas ERP.');
      setVendas(await response.json());
      setOffset(proximoOffset);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar vendas ERP.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const padrao = filtrosPadraoPeriodoAtual();
    setFiltros(padrao);
    carregarOpcoesFiltros();
    carregarVendas(0, padrao);
  }, []);

  function atualizarFiltro(chave: keyof FiltrosListagemVendas, valor: string) {
    setFiltros((atual) => ajustarFiltrosListagemVendas(atual, chave, valor));
  }

  function filtrarVendas() {
    carregarVendas(0, filtros);
  }

  function limparFiltros() {
    const padrao = filtrosPadraoPeriodoAtual();
    setFiltros(padrao);
    carregarVendas(0, padrao);
  }

  function paginaAnterior() {
    carregarVendas(Math.max(0, offset - TAMANHO_PAGINA_VENDAS), filtros);
  }

  function proximaPagina() {
    carregarVendas(offset + TAMANHO_PAGINA_VENDAS, filtros);
  }

  const colunas = colunasVendasErp;

  return (
    <section>
      <FiltrosVendas
        filtros={filtros}
        opcoes={opcoesFiltros}
        loading={loading}
        onChange={atualizarFiltro}
        onFiltrar={filtrarVendas}
        onLimpar={limparFiltros}
      />

      <div className="panel">
        <div className="db-title-row">
          <div className="db-title-row-content">
            <h2>Registros importados do INTERDATA</h2>
          
            <div className="db-page-controls">
              {/* <button className="secondary" onClick={paginaAnteriorBanco} disabled={offsetBanco === 0 || loading}><ChevronLeft size={16}/> 1000 anteriores</button> */}
              <span className="muted">Exibindo {vendas.length === 0 ? 0 : offset + 1}–{Math.min(offset + TAMANHO_PAGINA_VENDAS, vendas.length)} de {vendas.length}</span>
              
              {/* <button className="secondary" onClick={proximaPaginaBanco} disabled={offsetBanco + detalhe.linhas.length >= detalhe.total_linhas || loading}>Próximos 1000 <ChevronRight size={16}/></button> */}
            </div>
          </div>
        </div>
        {message && <p className="message">{message}</p>}
        <div className="table-pagination-shell">
          <button className="page-nav page-nav-left" onClick={paginaAnterior} disabled={offset === 0 || loading} title="1000 anteriores" aria-label="1000 anteriores"><ChevronLeft size={22}/></button>
          <div className="table-wrap db-data-table">
            <table>
              <thead>
                <tr>{colunas.map((coluna) => <th key={coluna.chave}>{coluna.titulo}</th>)}</tr>
              </thead>
              <tbody>
                {vendas.map((venda) => (
                  <tr key={venda.id}>
                    {colunas.map((coluna) => <td key={coluna.chave}>{exibirVenda(venda, coluna.chave)}</td>)}
                  </tr>
                ))}
                {vendas.length === 0 && <tr><td colSpan={colunas.length}>Nenhuma venda ERP encontrada para os filtros selecionados.</td></tr>}
              </tbody>
            </table>
          </div>
          <button className="page-nav page-nav-right" onClick={proximaPagina} disabled={loading || vendas.length < TAMANHO_PAGINA_VENDAS} title="Próximos 1000" aria-label="Próximos 1000"><ChevronRight size={22}/></button>
        </div>
      </div>
    </section>
  );
}

type VendaAdquirente = {
  id: string;
  importacao_id: string;
  adquirente: string;
  layout_origem: string;
  tipo_arquivo: string;
  codigo_registro: string;
  numero_linha: number;
  data_venda?: string;
  hora_venda?: string;
  data_pagamento?: string;
  valor_bruto?: string;
  valor_liquido?: string;
  valor_taxa?: string;
  percentual_taxa?: string;
  nsu?: string;
  codigo_autorizacao?: string;
  terminal?: string;
  bandeira?: string;
  modalidade?: string;
  parcelas?: string;
  status_transacao?: string;
  codigo_produto?: string;
  valores_exibicao?: Record<string, unknown>;
};

type VendaAdquirenteColuna = 'adquirente' | 'data_venda_hora' | 'valor_bruto' | 'valor_taxa' | 'percentual_taxa' | 'valor_liquido' | 'modalidade' | 'bandeira' | 'parcelas' | 'status_transacao' | 'terminal' | 'nsu' | 'codigo_autorizacao';

const colunasVendasAdquirentes: { chave: VendaAdquirenteColuna; titulo: string }[] = [
  { chave: 'adquirente', titulo: 'Adquirente' },
  { chave: 'data_venda_hora', titulo: 'Data venda' },
  { chave: 'valor_bruto', titulo: 'Valor bruto' },
  { chave: 'valor_taxa', titulo: 'Valor taxa' },
  { chave: 'percentual_taxa', titulo: '%taxa' },
  { chave: 'valor_liquido', titulo: 'Valor líquido' },
  { chave: 'modalidade', titulo: 'Modalidade' },
  { chave: 'bandeira', titulo: 'Bandeira' },
  { chave: 'status_transacao', titulo: 'Status' },
  { chave: 'parcelas', titulo: 'Parcelas' },
  { chave: 'terminal', titulo: 'Terminal' },
  { chave: 'nsu', titulo: 'NSU' },
  { chave: 'codigo_autorizacao', titulo: 'Código autorização' },
];

function horaParaOrdenacao(hora?: unknown) {
  const texto = String(hora ?? '').trim();
  if (!texto || texto === '-') return '00:00:00';
  const compacto = texto.replace(/\D/g, '');
  if (/^\d{6}$/.test(compacto)) return `${compacto.slice(0, 2)}:${compacto.slice(2, 4)}:${compacto.slice(4, 6)}`;
  if (/^\d{4}$/.test(compacto)) return `${compacto.slice(0, 2)}:${compacto.slice(2, 4)}:00`;
  const partes = texto.split(':').map((parte) => parte.replace(/\D/g, '').padStart(2, '0'));
  const [hh = '00', mm = '00', ss = '00'] = partes;
  return `${hh.slice(0, 2)}:${mm.slice(0, 2)}:${ss.slice(0, 2)}`;
}

function timestampVendaParaOrdenacao(data?: unknown, hora?: unknown) {
  const dataTexto = String(data ?? '').trim();
  const horaNormalizada = horaParaOrdenacao(hora);
  if (!dataTexto) return 0;

  const iso = dataTexto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const timestamp = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T${horaNormalizada}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const compactaBr = dataTexto.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (compactaBr) {
    const timestamp = Date.parse(`${compactaBr[3]}-${compactaBr[2]}-${compactaBr[1]}T${horaNormalizada}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const br = dataTexto.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (br) {
    const ano = br[3].length === 2 ? `20${br[3]}` : br[3];
    const timestamp = Date.parse(`${ano}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}T${horaNormalizada}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const timestamp = Date.parse(dataTexto);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function ordenarVendasAdquirentesPorDataHoraDesc(a: VendaAdquirente, b: VendaAdquirente) {
  const dataB = timestampVendaParaOrdenacao(b.data_venda, b.hora_venda);
  const dataA = timestampVendaParaOrdenacao(a.data_venda, a.hora_venda);
  if (dataB !== dataA) return dataB - dataA;
  const criacaoB = Date.parse(String((b as any).data_criacao || '')) || 0;
  const criacaoA = Date.parse(String((a as any).data_criacao || '')) || 0;
  if (criacaoB !== criacaoA) return criacaoB - criacaoA;
  return Number(b.numero_linha || 0) - Number(a.numero_linha || 0);
}

function exibirAdquirente(venda: VendaAdquirente, coluna: VendaAdquirenteColuna) {
  if (coluna === 'data_venda_hora') return normalizarDataHora(venda.data_venda, venda.hora_venda);
  if (coluna === 'adquirente') return <RenderAdquirenteLogo valor={venda.adquirente} />;
  if (coluna === 'bandeira') return <RenderBandeiraLogo valor={venda.valores_exibicao?.bandeira ?? venda.bandeira} />;
  if (COLUNAS_PERCENTUAL.has(String(coluna))) return formatarPercentual(venda.valores_exibicao?.[String(coluna)] ?? venda[coluna as keyof VendaAdquirente]);
  if (COLUNAS_MOEDA.has(String(coluna))) {
    const convertidoMoeda = venda.valores_exibicao?.[String(coluna)];
    return formatarMoedaBrasil(convertidoMoeda ?? venda[coluna as keyof VendaAdquirente]);
  }
  const convertido = venda.valores_exibicao?.[String(coluna)];
  const original = venda[coluna as keyof VendaAdquirente];
  if (convertido !== undefined && convertido !== original) {
    return <span title={`Valor original: ${valorTabela(original)}`}>{valorTabela(convertido)} <small className="conversion-mark">convertido</small></span>;
  }
  return valorTabela(original);
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

function VendasAdquirentesPage() {
  const [vendas, setVendas] = useState<VendaAdquirente[]>([]);
  const [message, setMessage] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [opcoesFiltros, setOpcoesFiltros] = useState<OpcoesFiltrosVendas>(opcoesFiltrosVazias);
  const [filtros, setFiltros] = useState<FiltrosListagemVendas>(() => filtrosPadraoPeriodoAtual());

  async function carregarOpcoesFiltros() {
    try {
      const response = await fetch(`${API_URL}/api/vendas-adquirentes/opcoes`);
      if (response.ok) setOpcoesFiltros(await response.json());
    } catch {
      // As opções são auxiliares; a tabela ainda pode carregar sem elas.
    }
  }

  async function carregarVendas(proximoOffset = offset, proximosFiltros = filtros) {
    setMessage('');
    setLoading(true);
    try {
      const params = montarParamsListagemVendas(proximosFiltros, TAMANHO_PAGINA_VENDAS, proximoOffset);
      const response = await fetch(`${API_URL}/api/vendas-adquirentes?${params.toString()}`);
      if (!response.ok) throw new Error('Não foi possível carregar as vendas das adquirentes.');
      const data: VendaAdquirente[] = await response.json();
      setVendas([...data].sort(ordenarVendasAdquirentesPorDataHoraDesc));
      setOffset(proximoOffset);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar vendas das adquirentes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const padrao = filtrosPadraoPeriodoAtual();
    setFiltros(padrao);
    carregarOpcoesFiltros();
    carregarVendas(0, padrao);
  }, []);

  function atualizarFiltro(chave: keyof FiltrosListagemVendas, valor: string) {
    setFiltros((atual) => ajustarFiltrosListagemVendas(atual, chave, valor));
  }

  function filtrarVendas() {
    carregarVendas(0, filtros);
   
  }

  function limparFiltros() {
    const padrao = filtrosPadraoPeriodoAtual();
    setFiltros(padrao);
    carregarVendas(0, padrao);
  }

  function paginaAnterior() {
    carregarVendas(Math.max(0, offset - TAMANHO_PAGINA_VENDAS), filtros);

  }

  function proximaPagina() {
    carregarVendas(offset + TAMANHO_PAGINA_VENDAS, filtros);
   
  }

  const colunas = colunasVendasAdquirentes;

  return (
    <section>
      <FiltrosVendas
        filtros={filtros}
        opcoes={opcoesFiltros}
        loading={loading}
        exibirAdquirente
        onChange={atualizarFiltro}
        onFiltrar={filtrarVendas}
        onLimpar={limparFiltros}
      />
       
      <div className="panel">
        <div className="db-title-row">
          <div className="db-title-row-content">
            <h2>Registros das adquirentes</h2>
            <div className="db-page-controls">
              {/* <button className="secondary" onClick={paginaAnteriorBanco} disabled={offsetBanco === 0 || loading}><ChevronLeft size={16}/> 1000 anteriores</button> */}
              <span className="muted">Exibindo {vendas.length === 0 ? 0 : offset + 1}–{Math.min(offset + TAMANHO_PAGINA_VENDAS, vendas.length)} de {vendas.length}</span>
              
              {/* <button className="secondary" onClick={proximaPaginaBanco} disabled={offsetBanco + detalhe.linhas.length >= detalhe.total_linhas || loading}>Próximos 1000 <ChevronRight size={16}/></button> */}
            </div>
          </div>
        </div>
        {message && <p className="message">{message}</p>}
        <div className="table-pagination-shell">
          <button className="page-nav page-nav-left" onClick={paginaAnterior} disabled={offset === 0 || loading} title="1000 anteriores" aria-label="1000 anteriores"><ChevronLeft size={22}/></button>
          <div className="table-wrap db-data-table">
            <table>
              <thead><tr>{colunas.map((coluna) => <th key={coluna.chave}>{coluna.titulo}</th>)}</tr></thead>
              <tbody>
                {vendas.map((venda) => (
                  <tr key={venda.id}>{colunas.map((coluna) => <td key={coluna.chave}>{exibirAdquirente(venda, coluna.chave)}</td>)}</tr>
                ))}
                {vendas.length === 0 && <tr><td colSpan={colunas.length}>Nenhuma venda de adquirente encontrada para os filtros selecionados.</td></tr>}
              </tbody>
            </table>
          </div>
          <button className="page-nav page-nav-right" onClick={proximaPagina} disabled={loading || vendas.length < TAMANHO_PAGINA_VENDAS} title="Próximos 1000" aria-label="Próximos 1000"><ChevronRight size={22}/></button>
        </div>
      </div>
    </section>
  );
}

type RelatorioGrupo = {
  chave: string;
  data?: string;
  data_pagamento?: string;
  bruto: number;
  taxa: number;
  liquido: number;
  quantidade: number;
  ticket_medio: number;
  taxa_media_percentual: number;
};

type RelatorioAdquirentes = {
  opcoes: {
    adquirentes: string[];
    modalidades: string[];
    bandeiras: string[];
    terminais: string[];
    status: string[];
  };
  resumo: {
    total_bruto: number;
    total_taxas: number;
    total_liquido: number;
    quantidade_transacoes: number;
    ticket_medio: number;
    taxa_media_percentual: number;
    autorizadas: number;
    canceladas_ou_negadas: number;
  };
  por_dia: RelatorioGrupo[];
  por_adquirente: RelatorioGrupo[];
  por_forma_pagamento: RelatorioGrupo[];
  por_modalidade: RelatorioGrupo[];
  por_bandeira: RelatorioGrupo[];
  por_terminal: RelatorioGrupo[];
  recebiveis: RelatorioGrupo[];
};

type FiltrosRelatorio = {
  data_inicio: string;
  data_fim: string;
  adquirente: string;
  forma_pagamento: string;
  modalidade: string;
  bandeira: string;
  terminal: string;
  status: string;
};

function formatarDataInputLocal(data: Date) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function filtrosPadraoPeriodoAtual(): FiltrosRelatorio {
  const hoje = new Date();
  const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  return {
    data_inicio: formatarDataInputLocal(primeiroDiaMes),
    data_fim: formatarDataInputLocal(hoje),
    adquirente: '',
    forma_pagamento: '',
    modalidade: '',
    bandeira: '',
    terminal: '',
    status: '',
  };
}

const filtrosVazios: FiltrosRelatorio = filtrosPadraoPeriodoAtual();

const relatorioVazio: RelatorioAdquirentes = {
  opcoes: {
    adquirentes: [],
    modalidades: [],
    bandeiras: [],
    terminais: [],
    status: [],
  },
  resumo: {
    total_bruto: 0,
    total_taxas: 0,
    total_liquido: 0,
    quantidade_transacoes: 0,
    ticket_medio: 0,
    taxa_media_percentual: 0,
    autorizadas: 0,
    canceladas_ou_negadas: 0,
  },
  por_dia: [],
  por_adquirente: [],
  por_forma_pagamento: [],
  por_modalidade: [],
  por_bandeira: [],
  por_terminal: [],
  recebiveis: [],
};

function numeroRelatorio(valor: unknown) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function formatarPercentual(valor: unknown) {
  const numero = numeroRelatorio(valor);
  return `${numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function RelatorioResumoCard({
  label,
  value,
  type = 'money',
}: {
  label: string;
  value: unknown;
  type?: 'money' | 'number' | 'percent';
}) {
  const texto =
    type === 'money'
      ? formatarMoedaBrasil(value)
      : type === 'percent'
        ? formatarPercentual(value)
        : numeroRelatorio(value).toLocaleString('pt-BR');

  return (
    <div className="card">
      <span>{label}</span>
      <strong>{texto}</strong>
    </div>
  );
}

function RelatorioTabela({
  titulo,
  linhas,
  label = 'Grupo',
}: {
  titulo: string;
  linhas: RelatorioGrupo[];
  label?: string;
}) {
  return (
    <div className="panel report-panel">
      <h2>{titulo}</h2>

      <div className="table-wrap report-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{label}</th>
              <th>Qtd.</th>
              <th>Bruto</th>
              <th>Taxa</th>
              <th>Líquido</th>
              <th>Ticket médio</th>
              <th>Taxa média</th>
            </tr>
          </thead>

          <tbody>
            {linhas.map((linha) => (
              <tr key={`${titulo}-${linha.chave}`}>
                <td>{linha.data || linha.data_pagamento || linha.chave}</td>
                <td>{numeroRelatorio(linha.quantidade).toLocaleString('pt-BR')}</td>
                <td>{formatarMoedaBrasil(linha.bruto)}</td>
                <td>{formatarMoedaBrasil(linha.taxa)}</td>
                <td>{formatarMoedaBrasil(linha.liquido)}</td>
                <td>{formatarMoedaBrasil(linha.ticket_medio)}</td>
                <td>{formatarPercentual(linha.taxa_media_percentual)}</td>
              </tr>
            ))}

            {linhas.length === 0 && (
              <tr>
                <td colSpan={7}>Sem dados para os filtros selecionados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RelatorioBarras({
  titulo,
  linhas,
}: {
  titulo: string;
  linhas: RelatorioGrupo[];
}) {
  const maximo = Math.max(...linhas.map((linha) => numeroRelatorio(linha.bruto)), 1);

  return (
    <div className="panel report-panel">
      <h2>{titulo}</h2>

      <div className="report-bars">
        {linhas.slice(0, 8).map((linha) => {
          const percentual = Math.max(2, (numeroRelatorio(linha.bruto) / maximo) * 100);

          return (
            <div className="report-bar-row" key={`${titulo}-${linha.chave}`}>
              <span title={linha.chave}>{linha.chave}</span>

              <div className="report-bar-track">
                <div
                  className="report-bar-fill"
                  style={{ width: `${percentual}%` }}
                />
              </div>

              <strong>{formatarMoedaBrasil(linha.bruto)}</strong>
            </div>
          );
        })}
        
        {linhas.length === 0 && (
          <p className="muted-report">Sem dados para exibir.</p>
        )}
      </div>
    </div>
  );
}

function RelatoriosAdquirentesPage() {
  const [relatorio, setRelatorio] = useState<RelatorioAdquirentes>(relatorioVazio);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosRelatorio>(() => filtrosPadraoPeriodoAtual());

  async function carregarRelatorio(proximosFiltros = filtros) {
    setLoading(true);
    setMessage('');

    try {
      const params = new URLSearchParams();

      Object.entries(proximosFiltros).forEach(([chave, valor]) => {
        if (!valor) return;
        params.set(chave, valor);
      });

      const response = await fetch(
        `${API_URL}/api/relatorios-adquirentes?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error('Não foi possível carregar os relatórios das adquirentes.');
      }

      setRelatorio(await response.json());
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Erro ao carregar relatórios das adquirentes.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregarRelatorio(filtrosPadraoPeriodoAtual());
  }, []);

  function atualizarFiltro(chave: keyof FiltrosRelatorio, valor: string) {
    setFiltros((atual) => {
      const proximos: FiltrosRelatorio = {
        ...atual,
        [chave]: valor,
      };

      if (chave === 'forma_pagamento') {
        if (valor === 'PIX') {
          proximos.modalidade = 'PIX';
          proximos.bandeira = '';
        }

        if (valor === 'CARTAO') {
          if (proximos.modalidade === 'PIX') proximos.modalidade = '';
          if (proximos.bandeira === 'PIX') proximos.bandeira = '';
        }

        if (!valor) {
          proximos.modalidade = '';
          proximos.bandeira = '';
        }
      }

      if (chave === 'modalidade') {
        if (valor === 'PIX') {
          proximos.forma_pagamento = 'PIX';
          proximos.bandeira = '';
        }

        if (valor && valor !== 'PIX' && proximos.forma_pagamento === 'PIX') {
          proximos.forma_pagamento = 'CARTAO';
          if (proximos.bandeira === 'PIX') proximos.bandeira = '';
        }
      }

      return proximos;
    });
  }

  function limparFiltros() {
    const padrao = filtrosPadraoPeriodoAtual();
    setFiltros(padrao);
    carregarRelatorio(padrao);
  }

  const modalidadesDisponiveis = relatorio.opcoes.modalidades.filter((item) => {
    const modalidade = String(item || '').toUpperCase();
    if (filtros.forma_pagamento === 'PIX') return modalidade === 'PIX';
    if (filtros.forma_pagamento === 'CARTAO') return modalidade !== 'PIX';
    return true;
  });

  const bandeirasDisponiveis = relatorio.opcoes.bandeiras.filter((item) => {
    const bandeira = String(item || '').toUpperCase();
    if (filtros.forma_pagamento === 'CARTAO') return bandeira !== 'PIX';
    return true;
  });

  const bandeiraBloqueada = filtros.forma_pagamento === 'PIX';

  return (
    <section className="reports-page">
      <div className="panel report-filters">
        <div>
          <label>Data inicial</label>
          <input
            type="date"
            value={filtros.data_inicio}
            onChange={(event) => atualizarFiltro('data_inicio', event.target.value)}
          />
        </div>

        <div>
          <label>Data final</label>
          <input
            type="date"
            value={filtros.data_fim}
            onChange={(event) => atualizarFiltro('data_fim', event.target.value)}
          />
        </div>

        <div>
          <label>Adquirente</label>
          <select
            value={filtros.adquirente}
            onChange={(event) => atualizarFiltro('adquirente', event.target.value)}
          >
            <option value="">Todas</option>
            {relatorio.opcoes.adquirentes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Forma de pagamento</label>
          <select
            value={filtros.forma_pagamento}
            onChange={(event) => atualizarFiltro('forma_pagamento', event.target.value)}
          >
            <option value="">Todas</option>
            <option value="CARTAO">CARTÃO</option>
            <option value="PIX">PIX</option>
          </select>
        </div>

        <div>
          <label>Modalidade</label>
          <select
            value={filtros.modalidade}
            onChange={(event) => atualizarFiltro('modalidade', event.target.value)}
          >
            <option value="">Todas</option>
            {modalidadesDisponiveis.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Bandeira</label>
          <select
            value={filtros.bandeira}
            onChange={(event) => atualizarFiltro('bandeira', event.target.value)}
            disabled={bandeiraBloqueada}
            title={bandeiraBloqueada ? 'PIX não utiliza bandeira de cartão.' : undefined}
          >
            <option value="">{bandeiraBloqueada ? 'Não se aplica ao PIX' : 'Todas'}</option>
            {bandeirasDisponiveis.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Terminal</label>
          <select
            value={filtros.terminal}
            onChange={(event) => atualizarFiltro('terminal', event.target.value)}
          >
            <option value="">Todos</option>
            {relatorio.opcoes.terminais.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Status</label>
          <select
            value={filtros.status}
            onChange={(event) => atualizarFiltro('status', event.target.value)}
          >
            <option value="">Todos</option>
            {relatorio.opcoes.status.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="report-filter-actions">
          <button onClick={() => carregarRelatorio()} disabled={loading}>
            {loading ? 'Carregando...' : 'Filtrar'}
          </button>

          <button className="secondary" onClick={limparFiltros} disabled={loading}>
            Limpar
          </button>
        </div>
      </div>

      {message && <p className="message">{message}</p>}

      <div className="cards report-summary-cards">
        <RelatorioResumoCard label="Total bruto vendido" value={relatorio.resumo.total_bruto} />
        <RelatorioResumoCard label="Total de taxas" value={relatorio.resumo.total_taxas} />
        <RelatorioResumoCard label="Total líquido" value={relatorio.resumo.total_liquido} />
        <RelatorioResumoCard label="Transações" value={relatorio.resumo.quantidade_transacoes} type="number" />
        <RelatorioResumoCard label="Ticket médio" value={relatorio.resumo.ticket_medio} />
        <RelatorioResumoCard label="Taxa média" value={relatorio.resumo.taxa_media_percentual} type="percent" />
        <RelatorioResumoCard label="Autorizadas" value={relatorio.resumo.autorizadas} type="number" />
        <RelatorioResumoCard label="Canceladas/negadas" value={relatorio.resumo.canceladas_ou_negadas} type="number" />
      </div>

      <div className="report-grid-barras">
        <RelatorioBarras titulo="Vendas por adquirente" linhas={relatorio.por_adquirente} />
        <RelatorioBarras titulo="Vendas por forma de pagamento" linhas={relatorio.por_forma_pagamento} />
        <RelatorioBarras titulo="Vendas por modalidade" linhas={relatorio.por_modalidade} />
      </div>

      <div className="report-grid">
        <RelatorioTabela titulo="Resumo por adquirente" linhas={relatorio.por_adquirente} label="Adquirente" />
        <RelatorioTabela titulo="Resumo por modalidade" linhas={relatorio.por_modalidade} label="Modalidade" />
      </div>

      <RelatorioTabela titulo="Resumo diário" linhas={relatorio.por_dia} label="Data" />
      <RelatorioTabela titulo="Recebíveis por data de pagamento" linhas={relatorio.recebiveis} label="Data pagamento" />

      <div className="report-grid">
        <RelatorioTabela titulo="Resumo por bandeira" linhas={relatorio.por_bandeira} label="Bandeira" />
        <RelatorioTabela titulo="Ranking de terminais" linhas={relatorio.por_terminal} label="Terminal" />
      </div>
    </section>
  );
}


function BancoDadosPage() {
  const [tabelas, setTabelas] = useState<TabelaBancoResumo[]>([]);
  const [selecionada, setSelecionada] = useState<string>('');
  const [detalhe, setDetalhe] = useState<TabelaBancoDetalhe | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [limpando, setLimpando] = useState(false);
  const [offsetBanco, setOffsetBanco] = useState(0);
  const TAMANHO_PAGINA_BANCO = 1000;
  const [formConversao, setFormConversao] = useState({ id: '', tabela_origem: 'vendas_erp', coluna_origem: 'forma_pagamento', valor_original: '', valor_exibicao: '', adquirente_aplicacao: '', observacao: '' });

  async function carregarTabelas() {
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/banco/tabelas`);
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
      const response = await fetch(`${API_URL}/api/banco/tabelas/${nome}?limite=${TAMANHO_PAGINA_BANCO}&offset=${novoOffset}`);
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
      const response = await fetch(`${API_URL}/api/banco/tabelas/${selecionada}/limpar`, { method: 'DELETE' });
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

  function atualizarTabelaConversoesLocal(conversao: Record<string, unknown>, editando: boolean) {
    setDetalhe((atual) => {
      if (!atual || atual.nome !== 'conversoes') return atual;
      const linhas = editando
        ? atual.linhas.map((linha) => String(linha.id) === String(conversao.id) ? conversao : linha)
        : [conversao, ...atual.linhas];
      return { ...atual, linhas, total_linhas: editando ? atual.total_linhas : atual.total_linhas + 1 };
    });
    if (!editando) {
      setTabelas((atuais) => atuais.map((tabela) => tabela.nome === 'conversoes' ? { ...tabela, quantidade_linhas: tabela.quantidade_linhas + 1 } : tabela));
    }
  }

  async function cadastrarConversao(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const editando = Boolean(formConversao.id);
      const response = await fetch(editando ? `${API_URL}/api/conversoes/${formConversao.id}` : `${API_URL}/api/conversoes`, {
        method: editando ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formConversao, ativo: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível salvar a conversão.');
      setMessage(data.mensagem || (editando ? 'Conversão atualizada com sucesso.' : 'Conversão cadastrada com sucesso.'));
      if (data.conversao) atualizarTabelaConversoesLocal(data.conversao, editando);
      setFormConversao({ id: '', tabela_origem: 'vendas_erp', coluna_origem: 'forma_pagamento', valor_original: '', valor_exibicao: '', adquirente_aplicacao: '', observacao: '' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao salvar conversão.');
    }
  }

  function editarConversao(linha: Record<string, unknown>) {
    setFormConversao({
      id: String(linha.id || ''),
      tabela_origem: String(linha.tabela_origem || ''),
      coluna_origem: String(linha.coluna_origem || ''),
      valor_original: String(linha.valor_original || ''),
      valor_exibicao: String(linha.valor_exibicao || ''),
      adquirente_aplicacao: String(linha.adquirente_aplicacao || ''),
      observacao: String(linha.observacao || ''),
    });
    setMessage('Editando conversão selecionada. Ajuste os campos e clique em Salvar alterações.');
  }

  function cancelarEdicaoConversao() {
    setFormConversao({ id: '', tabela_origem: 'vendas_erp', coluna_origem: 'forma_pagamento', valor_original: '', valor_exibicao: '', adquirente_aplicacao: '', observacao: '' });
    setMessage('');
  }

  async function excluirConversao(id: string) {
    const confirmou = window.confirm('Deseja excluir esta conversão? Esta ação não pode ser desfeita.');
    if (!confirmou) return;
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/conversoes/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível excluir a conversão.');
      setMessage(data.mensagem || 'Conversão excluída com sucesso.');
      if (formConversao.id === id) cancelarEdicaoConversao();
      setDetalhe((atual) => {
        if (!atual || atual.nome !== 'conversoes') return atual;
        return { ...atual, linhas: atual.linhas.filter((linha) => String(linha.id) !== id), total_linhas: Math.max(0, atual.total_linhas - 1) };
      });
      setTabelas((atuais) => atuais.map((tabela) => tabela.nome === 'conversoes' ? { ...tabela, quantidade_linhas: Math.max(0, tabela.quantidade_linhas - 1) } : tabela));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao excluir conversão.');
    }
  }

  function paginaAnteriorBanco() {
    if (!selecionada || offsetBanco === 0) return;
    abrirTabela(selecionada, Math.max(0, offsetBanco - TAMANHO_PAGINA_BANCO));
  }

  function proximaPaginaBanco() {
    if (!selecionada || !detalhe) return;
    abrirTabela(selecionada, offsetBanco + TAMANHO_PAGINA_BANCO);
  }

  useEffect(() => {
    carregarTabelas();
  }, []);

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
                </div>
                <div className="db-page-controls">
                {/* <button className="secondary" onClick={paginaAnteriorBanco} disabled={offsetBanco === 0 || loading}><ChevronLeft size={16}/> 1000 anteriores</button> */}
                <span className="muted">Exibindo {detalhe.total_linhas === 0 ? 0 : offsetBanco + 1}–{Math.min(offsetBanco + detalhe.linhas.length, detalhe.total_linhas)} de {detalhe.total_linhas}</span>
                {/* <button className="secondary" onClick={proximaPaginaBanco} disabled={offsetBanco + detalhe.linhas.length >= detalhe.total_linhas || loading}>Próximos 1000 <ChevronRight size={16}/></button> */}
              </div>
              </div>

              <div className="columns-box">
                {detalhe.colunas.map((coluna) => <code key={coluna}>{coluna}</code>)}
              </div>

              {detalhe.nome === 'conversoes' && (
                <form className="conversion-form" onSubmit={cadastrarConversao}>
                  <div>
                    <label>Tabela origem</label>
                    <input value={formConversao.tabela_origem} onChange={(e) => setFormConversao({ ...formConversao, tabela_origem: e.target.value })} placeholder="vendas_erp" />
                  </div>
                  <div>
                    <label>Coluna origem</label>
                    <input value={formConversao.coluna_origem} onChange={(e) => setFormConversao({ ...formConversao, coluna_origem: e.target.value })} placeholder="forma_pagamento" />
                  </div>
                  <div>
                    <label>Valor original</label>
                    <input value={formConversao.valor_original} onChange={(e) => setFormConversao({ ...formConversao, valor_original: e.target.value })} placeholder="Cartão Crédito" />
                  </div>
                  <div>
                    <label>Exibir como</label>
                    <input value={formConversao.valor_exibicao} onChange={(e) => setFormConversao({ ...formConversao, valor_exibicao: e.target.value })} placeholder="CREDITO" />
                  </div>
                  <div>
                    <label>Adquirente</label>
                    <select value={formConversao.adquirente_aplicacao} onChange={(e) => setFormConversao({ ...formConversao, adquirente_aplicacao: e.target.value })}>
                      <option value="">Todas / não se aplica</option>
                      <option value="SIPAG">SIPAG</option>
                      <option value="CIELO">CIELO</option>
                      <option value="SICREDI">SICREDI</option>
                    </select>
                  </div>
                  <div className="conversion-observation">
                    <label>Observação</label>
                    <input value={formConversao.observacao} onChange={(e) => setFormConversao({ ...formConversao, observacao: e.target.value })} placeholder="Opcional" />
                  </div>
                  <button type="submit"><PlusCircle size={16}/> {formConversao.id ? 'Salvar alterações' : 'Adicionar conversão'}</button>
                  {formConversao.id && <button type="button" className="secondary" onClick={cancelarEdicaoConversao}><XCircle size={16}/> Cancelar edição</button>}
                </form>
              )}

              <div className="table-pagination-shell">
                <button className="page-nav page-nav-left" onClick={paginaAnteriorBanco} disabled={offsetBanco === 0 || loading} title="1000 anteriores" aria-label="1000 anteriores"><ChevronLeft size={22}/></button>
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
                <button className="page-nav page-nav-right" onClick={proximaPaginaBanco} disabled={offsetBanco + detalhe.linhas.length >= detalhe.total_linhas || loading} title="Próximos 1000" aria-label="Próximos 1000"><ChevronRight size={22}/></button>
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

type SftpPingResultado = {
  sucesso: boolean;
  habilitado: boolean;
  providers: SftpProviderResultado[];
};

type SftpColetaResultado = {
  sucesso: boolean;
  dryRun: boolean;
  providers: SftpProviderResultado[];
  mensagem?: string;
};

function SftpPage() {
  const [selecionados, setSelecionados] = useState({ cielo: true, sipag: true, sicredi: true, convcard: true, coletarSicoobPix: true });
  const [dryRun, setDryRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [ping, setPing] = useState<SftpPingResultado | null>(null);
  const [coleta, setColeta] = useState<SftpColetaResultado | null>(null);

  async function testarConexao() {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/importacoes/sftp/ping`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível testar o SFTP.');
      setPing(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao testar SFTP.');
    } finally {
      setLoading(false);
    }
  }

  async function coletarArquivos() {
    setLoading(true);
    setMessage('');
    setColeta(null);
    try {
      const response = await fetch(`${API_URL}/api/importacoes/sftp/coletar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selecionados, dryRun }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.mensagem || 'Não foi possível coletar arquivos SFTP.');
      setColeta(data);
      setMessage(dryRun ? 'Dry run concluído. Nenhum arquivo foi baixado.' : 'Coleta concluída e enviada ao classificador/importador.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao coletar arquivos SFTP.');
    } finally {
      setLoading(false);
    }
  }

  const providersResumo = coleta?.providers || ping?.providers || [];
    /*const providersResumo = [
      { provider: 'CIELO', sucesso: true, total_remoto: 10, total_candidatos: 8 },
      { provider: 'SIPAG', sucesso: false, erro: 'Erro de conexão' },
      { provider: 'SICREDI', sucesso: false, total_remoto: 5, total_candidatos: 5 },
      { provider: 'CONVCARD', sucesso: true, total_remoto: 3, total_candidatos: 2 },
      { provider: 'SIPAG 2.0', sucesso: true, total_remoto: 3, total_candidatos: 2 },
      { provider: 'SICOOB PIX-QRCODE', sucesso: true, total_remoto: 3, total_candidatos: 2 },
    ];*/

  return (
    <section>
      {/*
      <h1>SFTP EDI</h1>
      <p className="muted">Coleta centralizada dos arquivos EDI remotos. Os arquivos baixados entram no mesmo pipeline do upload manual: storage/importacoes/entrada → classificador → parser → banco.</p>

      <div className="cards compact">
        <div className="card"><span>Status</span><strong>{ping?.habilitado ? 'Ativo' : 'Aguardando teste'}</strong></div>
        <div className="card success"><span>Endpoint</span><strong>/sftp</strong></div>
        <div className="card warning"><span>Modo seguro</span><strong>{dryRun ? 'Dry run' : 'Coleta real'}</strong></div>
        <div className="card"><span>Providers</span><strong>C/S/S/CONV</strong></div>
      </div>*/}

      <div className="panel sftp-panel">
        {/*<div className="db-title-row">
          <div>
            <h2>Coletar arquivos do servidor SFTP</h2>
            <p className="muted">Use primeiro em modo dry run para listar os arquivos sem baixar. Depois desative o dry run para baixar e importar.</p>
          </div>
          <button className="secondary" onClick={testarConexao} disabled={loading}><Server size={16}/> Testar SFTP</button>
        </div>*/}

        <div className="sftp-options">
          <label><input type="checkbox" checked={selecionados.cielo} onChange={(e) => setSelecionados({ ...selecionados, cielo: e.target.checked })}/> CIELO</label>
          <label><input type="checkbox" checked={selecionados.sipag} onChange={(e) => setSelecionados({ ...selecionados, sipag: e.target.checked })}/> SIPAG</label>
          <label><input type="checkbox" checked={selecionados.sicredi} onChange={(e) => setSelecionados({ ...selecionados, sicredi: e.target.checked })}/> SICREDI</label>
          <label><input type="checkbox" checked={selecionados.convcard} onChange={(e) => setSelecionados({ ...selecionados, convcard: e.target.checked })}/> CONVCARD</label>
          <label><input type="checkbox" checked={selecionados.coletarSicoobPix} onChange={(e) => setSelecionados({ ...selecionados, coletarSicoobPix: e.target.checked })}/> SICOOB PSP PIX/API</label>
          {/*<label className="dryrun-option"><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)}/> Listar apenas (dryRun)</label>*/}
          <button onClick={coletarArquivos} disabled={loading || (!selecionados.cielo && !selecionados.sipag && !selecionados.sicredi && !selecionados.convcard && !selecionados.coletarSicoobPix)}><CloudDownload size={16}/> {loading ? 'Processando...' : 'Coletar arquivos'}</button>
        </div>
        {message && <p className="message">{message}</p>}
      </div>

      <div className="panel">
        <h2>Resultado por adquirente</h2>
        <div className="cards compact provider-cards">
          {providersResumo.map((provider) => (
            <div key={provider.provider} className={`card ${provider.sucesso ? 'success' : 'danger'}`}>
              <span>{provider.provider}</span>
              <strong>{provider.sucesso ? 'OK' : 'Falha'}</strong>
              <p className="muted">{provider.mensagem || provider.erro || `${provider.total_candidatos || 0} candidatos de ${provider.total_remoto || 0} remotos`}</p>
            </div>
          ))}
          {providersResumo.length === 0 && <p className="muted">Nenhum teste executado ainda.</p>}
        </div>
      </div>

      {coleta && (
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
      )}
    </section>
  );
}

function UsersPage() {
  return (
    <section>
      <h1>Usuários</h1>
      <p className="muted">Tela inicial reservada para gestão de usuários e permissões.</p>
      <div className="panel">
        <h2>Perfis previstos</h2>
        <ul>
          <li>Administrador</li>
          <li>Financeiro</li>
          <li>Conferente</li>
          <li>Somente leitura</li>
        </ul>
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
