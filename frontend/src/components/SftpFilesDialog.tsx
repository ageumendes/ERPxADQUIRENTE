import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FolderOpen, RefreshCcw, Server, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { API_URL, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/importacoes';
import './SftpFilesDialog.css';

type Provider = { key: string; nome: string; usuario: string; pastas: Array<{ key: string; caminho: string }> };
type RemoteFile = { nome: string; tamanho_bytes: number; modificado_em: string | null };
type Ping = { sucesso: boolean; habilitado: boolean; providers: Array<{ provider: string; sucesso: boolean; mensagem?: string }> };
type SavePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; id: string }) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }> };
const pageSize = 100;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
async function responseError(response: Response) {
  const data = await response.json().catch(() => null);
  return new Error(data?.mensagem || `Não foi possível concluir a operação (HTTP ${response.status}).`);
}

export function SftpFilesDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previouslyFocused = useRef(document.activeElement as HTMLElement | null);
  const downloadController = useRef<AbortController | null>(null);
  const pingController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const downloadBusy = useRef(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [providerKey, setProviderKey] = useState('');
  const [folder, setFolder] = useState('in');
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [configError, setConfigError] = useState('');
  const [revision, setRevision] = useState(0);
  const [configRevision, setConfigRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [testing, setTesting] = useState(false);
  const [ping, setPing] = useState<Ping | null>(null);
  const [pingError, setPingError] = useState('');
  const [downloading, setDownloading] = useState('');
  const [notice, setNotice] = useState('');
  const [downloaded, setDownloaded] = useState<Set<string>>(() => new Set());
  const provider = providers.find(p => p.key === providerKey);
  const currentPath = provider?.pastas.find(p => p.key === folder)?.caminho || `/${folder}`;

  useEffect(() => {
    mounted.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    return () => {
      mounted.current = false;
      downloadController.current?.abort();
      pingController.current?.abort();
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setConfigError('');
    void (async () => {
      try {
        const response = await apiFetch(`${API_URL}/api/importacoes/sftp/pastas`, { signal: controller.signal });
        if (!response.ok) throw await responseError(response);
        const data = await response.json();
        if (controller.signal.aborted) return;
        setProviders(data.providers); setEnabled(data.habilitado);
        setProviderKey((old) => old || data.providers[0]?.key || '');
        setFolder('in');
        setLoading(false);
      } catch (error) { if (!controller.signal.aborted) { setConfigError(errorMessage(error)); setLoading(false); } }
    })();
    return () => controller.abort();
  }, [configRevision]);

  useEffect(() => {
    if (!providerKey || !enabled) return;
    const controller = new AbortController();
    setLoading(true); setListError(''); setFiles([]); setPage(0);
    void (async () => {
      try {
        const params = new URLSearchParams({ provider: providerKey, pasta: folder });
        const response = await apiFetch(`${API_URL}/api/importacoes/sftp/arquivos?${params}`, { signal: controller.signal });
        if (!response.ok) throw await responseError(response);
        const data = await response.json();
        if (!controller.signal.aborted) setFiles(data.arquivos);
      } catch (error) { if (!controller.signal.aborted) setListError(errorMessage(error)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [providerKey, folder, enabled, revision]);

  async function testConnection() {
    if (testing) return;
    const controller = new AbortController(); pingController.current = controller;
    setTesting(true); setPingError(''); setPing(null);
    try {
      const response = await apiFetch(`${API_URL}/api/importacoes/sftp/ping`, { signal: controller.signal });
      if (!response.ok) throw await responseError(response);
      const data = await response.json();
      if (mounted.current) setPing(data);
    } catch (error) { if (mounted.current && !controller.signal.aborted) setPingError(errorMessage(error)); }
    finally { if (mounted.current) setTesting(false); }
  }

  async function download(file: RemoteFile) {
    if (downloadBusy.current) return;
    downloadBusy.current = true;
    const controller = new AbortController(); downloadController.current = controller;
    setDownloading(file.nome); setNotice('');
    try {
      // O seletor precisa abrir durante o clique, antes de aguardar a rede.
      const picker = (window as SavePickerWindow).showSaveFilePicker;
      const handle = picker ? await picker.call(window, { suggestedName: file.nome, id: 'sftp-segunda-via' }) : null;
      if (!mounted.current || controller.signal.aborted) return;
      const params = new URLSearchParams({ provider: providerKey, pasta: folder, nome: file.nome });
      const response = await apiFetch(`${API_URL}/api/importacoes/sftp/arquivo/download?${params}`, { signal: controller.signal });
      if (!response.ok) throw await responseError(response);
      if (handle) {
        if (!response.body) throw new Error('O servidor não enviou o conteúdo do arquivo.');
        const writable = await handle.createWritable();
        await response.body.pipeTo(writable, { signal: controller.signal });
        if (mounted.current) { setNotice(`Cópia salva: ${file.nome}`); setDownloaded(old => new Set(old).add(`${providerKey}|${folder}|${file.nome}`)); }
      } else {
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = file.nome;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        if (mounted.current) { setNotice(`Download enviado ao navegador: ${file.nome}`); setDownloaded(old => new Set(old).add(`${providerKey}|${folder}|${file.nome}`)); }
      }
    } catch (error) {
      if (mounted.current) setNotice(error instanceof DOMException && error.name === 'AbortError' ? 'Download cancelado.' : errorMessage(error));
    } finally {
      downloadBusy.current = false;
      if (mounted.current) setDownloading('');
    }
  }

  const filtered = useMemo(() => files.filter(file => file.nome.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())), [files, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return createPortal(<dialog ref={dialog} className="sftp-files-dialog" aria-labelledby="sftp-files-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="sftp-files-header">
      <div><h2 id="sftp-files-title"><FolderOpen size={22}/> Arquivos do servidor SFTP</h2><p className="muted">Consulte as pastas e salve uma segunda via no seu computador.</p></div>
      <button type="button" className="secondary" aria-label="Fechar arquivos SFTP" onClick={onClose} autoFocus><X size={20}/></button>
    </div>
    <div className="sftp-files-content">
      <div className="sftp-files-test"><button type="button" className="secondary" onClick={testConnection} disabled={testing}><Server size={16}/>{testing ? 'Testando conexões...' : 'Testar SFTP'}</button><span className="muted">Verifica a conexão e o acesso à pasta de entrada de cada adquirente.</span></div>
      {pingError && <p role="alert" className="message">{pingError}</p>}
      {ping && <div className="sftp-files-ping" aria-live="polite">{ping.providers.map(p => <div key={p.provider} className={p.sucesso ? 'sftp-test-ok' : 'sftp-test-fail'} title={p.mensagem}><strong>{p.provider} · {p.sucesso ? 'OK' : 'Falha'}</strong><span>{p.mensagem}</span></div>)}</div>}
      {configError && <p role="alert" className="message">{configError} <button className="secondary" onClick={() => setConfigRevision(v => v + 1)}>Tentar novamente</button></p>}
      {!enabled && <p role="alert" className="message">SFTP desabilitado na configuração do app.</p>}
      <div className="sftp-files-filters">
        <label>Adquirente / usuário<select value={providerKey} disabled={!providers.length || !!downloading} onChange={event => { setProviderKey(event.target.value); setSearch(''); setNotice(''); }} aria-label="Adquirente SFTP">{providers.map(p => <option key={p.key} value={p.key}>{p.nome} — {p.usuario}</option>)}</select></label>
        <label>Pasta<select value={folder} disabled={!provider || !!downloading} onChange={event => { setFolder(event.target.value); setSearch(''); setNotice(''); }} aria-label="Pasta SFTP">{provider?.pastas.map(p => <option key={p.key} value={p.key}>{p.caminho}</option>)}</select></label>
        <label>Buscar arquivo<input value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Nome ou parte do nome"/></label>
        <button type="button" className="secondary" disabled={loading || !provider || !enabled || !!downloading} onClick={() => setRevision(v => v + 1)}><RefreshCcw size={16}/> Atualizar lista</button>
      </div>
      <p className="muted sftp-files-path">{provider ? `${provider.usuario} · ${currentPath}` : 'Carregando configuração...'} · {files.length} arquivo(s)</p>
      {listError && <p role="alert" className="message">{listError}</p>}
      {notice && <p role="status" className="message">{notice}</p>}
      {downloading && <div role="status" className="sftp-files-test">Baixando cópia: {downloading}<button className="secondary" onClick={() => downloadController.current?.abort()}>Cancelar download</button></div>}
      <div className="sftp-files-table" aria-busy={loading}><table><thead><tr><th>Arquivo</th><th>Tamanho</th><th>Modificado em</th><th>Download</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={4}>Consultando arquivos no servidor...</td></tr> : visible.map(file => { const foiBaixado = downloaded.has(`${providerKey}|${folder}|${file.nome}`); return <tr key={file.nome} className={foiBaixado ? 'sftp-file-downloaded' : ''}><td className="sftp-file-name">{file.nome}{foiBaixado && <span className="sftp-downloaded-badge">Baixado</span>}</td><td>{formatBytes(file.tamanho_bytes)}</td><td>{file.modificado_em ? new Date(file.modificado_em).toLocaleString('pt-BR') : '—'}</td><td><button type="button" className="secondary sftp-download-button" disabled={!!downloading} onClick={() => void download(file)} title={foiBaixado ? `Baixar novamente ${file.nome}` : `Baixar cópia de ${file.nome}`} aria-label={`Baixar cópia de ${file.nome}`}><Download size={14}/></button></td></tr> })}
        {!loading && !listError && visible.length === 0 && <tr><td colSpan={4}>{search ? 'Nenhum arquivo corresponde à busca.' : 'Nenhum arquivo regular nesta pasta.'}</td></tr>}
      </tbody></table></div>
      <div className="sftp-files-pagination"><span className="muted">{filtered.length} arquivo(s) na busca · Página {page + 1} de {pageCount}</span><div><button className="secondary" aria-label="Página anterior de arquivos" disabled={page === 0} onClick={() => setPage(v => v - 1)}><ChevronLeft size={18}/></button><button className="secondary" aria-label="Próxima página de arquivos" disabled={page + 1 >= pageCount} onClick={() => setPage(v => v + 1)}><ChevronRight size={18}/></button></div></div>
    </div>
    <div className="sftp-files-footer"><p className="muted">{(window as SavePickerWindow).showSaveFilePicker ? 'Ao baixar, escolha a pasta e o nome no diálogo de salvar.' : 'O navegador define a pasta de destino. Ative “Perguntar onde salvar cada arquivo” nas configurações de downloads para escolher a pasta.'}</p><button type="button" className="secondary" onClick={onClose}>Fechar</button></div>
  </dialog>, document.body);
}
