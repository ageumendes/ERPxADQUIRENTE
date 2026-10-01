import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, CopyCheck, CreditCard, History, LayoutDashboard, LoaderCircle, ReceiptText, SearchCheck, Table2, Upload, UserRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import logoTigre from '../assets/logo-tigre.png';
import { API_URL, apiFetchSilencioso } from '../lib/api';
import { theme } from '../lib/theme';

type UsuarioShell = {
  nome: string;
  perfil: 'ADMINISTRADOR' | 'FINANCEIRO' | 'AUDITOR' | 'OPERADOR' | 'CONSULTA';
};

type AppShellProps = {
  usuario: UsuarioShell;
  sair: () => void;
  children: ReactNode;
};

const itensMenu = [
  { caminho: '/dashboard', rotulo: 'Dashboard', Icone: LayoutDashboard },
  { caminho: '/conciliacoes', rotulo: 'Conciliações', Icone: SearchCheck },
  { caminho: '/imports', rotulo: 'Importações', Icone: Upload },
  { caminho: '/erp-vendas', rotulo: 'Vendas ERP', Icone: ReceiptText },
  { caminho: '/adquirentes-vendas', rotulo: 'Vendas Adquirentes', Icone: CreditCard },
  { caminho: '/relatorios-adquirentes', rotulo: 'Relatórios Adquirentes', Icone: BarChart3 },
] as const;

export function AppShell({ usuario, sair, children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [recolhido, setRecolhido] = useState(() => localStorage.getItem('erp_sidebar_recolhida') === '1');
  const [requisicoesAtivas, setRequisicoesAtivas] = useState(0);
  const [atividadeServidor, setAtividadeServidor] = useState({ ativa: false, etapa: '' });

  useEffect(() => {
    // v0.1.232: escala o workspace inteiro de forma contínua.
    // 1880px = 100%; 1326px ≈ 75%, reproduzindo o resultado aprovado
    // com zoom manual do navegador, mas sem alterar o zoom do usuário.
    const atualizarEscalaRaiz = () => {
      const largura = window.innerWidth;
      let escala = 1;
      if (largura > 980 && largura < 1326) {
        escala = 0.70 + ((largura - 981) / (1326 - 981)) * 0.05;
      } else if (largura >= 1326 && largura < 1880) {
        escala = 0.75 + ((largura - 1326) / (1880 - 1326)) * 0.25;
      }
      document.documentElement.style.setProperty('--app-root-scale', escala.toFixed(4));
      document.documentElement.style.setProperty('--app-root-inverse', (1 / escala).toFixed(4));
    };
    atualizarEscalaRaiz();
    window.addEventListener('resize', atualizarEscalaRaiz);
    return () => {
      window.removeEventListener('resize', atualizarEscalaRaiz);
      document.documentElement.style.removeProperty('--app-root-scale');
      document.documentElement.style.removeProperty('--app-root-inverse');
    };
  }, []);

  useEffect(() => {
    const acompanharRequisicoes = (event: Event) => {
      const detalhe = (event as CustomEvent<{ ativas?: number }>).detail;
      setRequisicoesAtivas(Math.max(0, Number(detalhe?.ativas || 0)));
    };
    window.addEventListener('erp:atividade-http', acompanharRequisicoes);
    return () => window.removeEventListener('erp:atividade-http', acompanharRequisicoes);
  }, []);

  useEffect(() => {
    let ativo = true;
    let consultando = false;
    let temporizador: number | undefined;
    let controlador: AbortController | null = null;
    const agendar = () => {
      if (!ativo) return;
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(() => void consultar(), 5_000);
    };
    const consultar = async () => {
      if (!ativo || consultando) return;
      if (document.hidden) { agendar(); return; }
      consultando = true;
      controlador = new AbortController();
      try {
        const response = await apiFetchSilencioso(`${API_URL}/api/importacoes/fila/status`, { cache: 'no-store', signal: controlador.signal });
        if (!response.ok) return;
        const status = await response.json();
        if (ativo) setAtividadeServidor({ ativa: Boolean(status.atividade_em_segundo_plano), etapa: String(status.etapa || '') });
      } catch {
        // O indicador é auxiliar e não deve interromper a navegação se o polling falhar.
      } finally {
        consultando = false;
        controlador = null;
        agendar();
      }
    };
    const aoAlterarVisibilidade = () => {
      if (document.hidden || !ativo) return;
      window.clearTimeout(temporizador);
      void consultar();
    };
    void consultar();
    document.addEventListener('visibilitychange', aoAlterarVisibilidade);
    return () => {
      ativo = false;
      window.clearTimeout(temporizador);
      controlador?.abort();
      document.removeEventListener('visibilitychange', aoAlterarVisibilidade);
    };
  }, []);

  const atividadeVisivel = requisicoesAtivas > 0 || atividadeServidor.ativa;
  const descricaoAtividade = atividadeServidor.etapa || 'Serviço em segundo plano';

  const alternarMenu = () => setRecolhido((atual) => {
    const proximo = !atual;
    localStorage.setItem('erp_sidebar_recolhida', proximo ? '1' : '0');
    return proximo;
  });

  const renderItem = (caminho: string, rotulo: string, Icone: typeof LayoutDashboard) => {
    const ativo = location.pathname === caminho;
    return (
      <button key={caminho} aria-current={ativo ? 'page' : undefined} className={ativo ? 'active' : ''} onClick={() => navigate(caminho)}>
        <Icone size={18}/><span className="menu-label">{rotulo}</span>
      </button>
    );
  };

  return (
    <div className="app-shell">
      {atividadeVisivel && <div className="global-activity-bar" aria-hidden="true"><span /></div>}
      <aside className={`sidebar${recolhido ? ' collapsed' : ''}`}>
        <button className="sidebar-toggle" onClick={alternarMenu} title={recolhido ? 'Expandir menu' : 'Recolher menu'} aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}>
          {recolhido ? <ChevronRight size={30}/> : <ChevronLeft size={30}/>}
        </button>
        <div className="brand brand-logo">
          <img src={logoTigre} alt="Supermercado Tigre" />
          <div><strong>ERPxADQUIRENTE</strong><span>v{theme.version}</span></div>
        </div>
        {itensMenu.map(({ caminho, rotulo, Icone }) => renderItem(caminho, rotulo, Icone))}
        {usuario.perfil === 'ADMINISTRADOR' && <>
          {renderItem('/duplicidades', 'Duplicidades', CopyCheck)}
          {renderItem('/auditoria-reversoes', 'Auditoria / Reversões', History)}
          {renderItem('/banco', 'Banco de Dados', Table2)}
        </>}
      </aside>

      <main className="content">
        <header className="topbar">
          <div className="topbar-system">
            <div className="topbar-system-copy">
              <div className="topbar-title">Sistema de Conciliação ERP x ADQUIRENTES</div>
              <span>INTERDATA • SIPAG • SICOOB • CIELO • SICREDI • PIX • CONVCARD • VR</span>
            </div>
            {atividadeServidor.ativa && <div className="background-task-notice" title={descricaoAtividade} aria-live="polite" role="status"><LoaderCircle size={17}/><div><strong>{descricaoAtividade}</strong><small>Possíveis atrasos nas próximas solicitações enquanto a tarefa é executada em segundo plano.</small></div></div>}
          </div>
          <div className="topbar-actions">
            {requisicoesAtivas > 0 && <span className="global-activity-spinner" title="Carregando dados" aria-label="Carregando dados" role="status"><LoaderCircle size={16}/><span>Carregando dados</span></span>}
            {usuario.perfil === 'ADMINISTRADOR' ? <button className="topbar-user-button" onClick={() => navigate('/users')} title={`${usuario.nome} · ${usuario.perfil}`} aria-label={`Gerenciar usuários — ${usuario.nome} · ${usuario.perfil}`}><UserRound size={21}/></button> : <span>{usuario.nome} · {usuario.perfil}</span>}<button className="button secondary" onClick={sair}>Sair</button>
          </div>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
