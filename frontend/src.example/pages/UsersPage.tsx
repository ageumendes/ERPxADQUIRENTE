import React, { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Save, ShieldCheck, UserRound, X } from 'lucide-react';
import { API_URL, apiFetch } from '../lib/api';

type Usuario = { id:string; nome:string; login:string; perfil:string; ativo:boolean; trocar_senha:boolean };
const PERFIS = ['ADMINISTRADOR','FINANCEIRO','AUDITOR','OPERADOR','CONSULTA'];

export function UsersPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [mensagem, setMensagem] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ nome: '', login: '', senha: '', perfil: 'CONSULTA' });
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [edicao, setEdicao] = useState({ nome:'', login:'', perfil:'CONSULTA', senha:'' });

  async function carregar() { const response = await apiFetch(`${API_URL}/api/usuarios`); const body = await response.json(); if (response.ok) setUsuarios(body.usuarios || []); else setMensagem(body.mensagem); }
  useEffect(() => { void carregar(); }, []);
  async function cadastrar(event: React.FormEvent) { event.preventDefault(); setLoading(true); setMensagem(''); try { const response = await apiFetch(`${API_URL}/api/usuarios`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(form) }); const body=await response.json(); setMensagem(body.mensagem || (response.ok?'Usuário criado com sucesso.':'Erro ao criar usuário.')); if(response.ok){setForm({nome:'',login:'',senha:'',perfil:'CONSULTA'});await carregar();} } finally { setLoading(false); } }
  function iniciarEdicao(usuario:Usuario){ setEditando(usuario); setEdicao({nome:usuario.nome,login:usuario.login,perfil:usuario.perfil,senha:''}); }
  async function salvarEdicao(){ if(!editando)return; setLoading(true); setMensagem(''); try { const payload:any={nome:edicao.nome,login:edicao.login,perfil:edicao.perfil}; if(edicao.senha.trim())payload.senha=edicao.senha; const response=await apiFetch(`${API_URL}/api/usuarios/${editando.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const body=await response.json(); setMensagem(body.mensagem || (response.ok?'Usuário atualizado com sucesso.':'Erro ao atualizar usuário.')); if(response.ok){setEditando(null);await carregar();} } finally { setLoading(false); } }
  async function alternar(usuario:Usuario){ const acao=usuario.ativo?'desativar':'ativar'; if(!window.confirm(`Deseja ${acao} o usuário ${usuario.nome}?`))return; const response=await apiFetch(`${API_URL}/api/usuarios/${usuario.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ativo:!usuario.ativo})}); const body=await response.json(); setMensagem(body.mensagem || (response.ok?'Usuário atualizado.':'Erro ao atualizar.')); if(response.ok)await carregar(); }

  return <section className="users-page">
    <div className="users-title"><div><h1>Usuários</h1><p className="muted">Gerencie acessos, perfis e credenciais do ERPxADQUIRENTE.</p></div><div className="users-title-icon"><ShieldCheck size={22}/></div></div>
    {mensagem && <div className="notice">{mensagem}</div>}
    <div className="panel users-create-card"><div className="users-section-title"><Plus size={18}/><div><h2>Novo usuário</h2><span>Crie um acesso e defina o nível de permissão.</span></div></div>
      <form className="users-form" onSubmit={cadastrar}>
        <label>Nome<input placeholder="Nome completo" value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} required/></label>
        <label>Login<input placeholder="ex.: joao.silva" value={form.login} onChange={e=>setForm({...form,login:e.target.value})} required/></label>
        <label>Senha temporária<input type="password" placeholder="Mínimo 8 caracteres" value={form.senha} onChange={e=>setForm({...form,senha:e.target.value})} required minLength={8}/></label>
        <label>Perfil<select value={form.perfil} onChange={e=>setForm({...form,perfil:e.target.value})}>{PERFIS.map(p=><option key={p}>{p}</option>)}</select></label>
        <button className="button primary users-submit" type="submit" disabled={loading}><Plus size={16}/>Cadastrar</button>
      </form>
    </div>
    <div className="panel users-list-card"><div className="users-section-title"><UserRound size={18}/><div><h2>Usuários cadastrados</h2><span>{usuarios.length} usuário(s) registrado(s)</span></div></div><div className="table-wrap"><table className="users-table"><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Status</th><th>Senha</th><th>Ações</th></tr></thead><tbody>{usuarios.map(usuario=><tr key={usuario.id}><td><strong>{usuario.nome}</strong></td><td>{usuario.login}</td><td><span className={`user-role role-${usuario.perfil.toLowerCase()}`}>{usuario.perfil}</span></td><td><span className={`user-status ${usuario.ativo?'active':'inactive'}`}><span/>{usuario.ativo?'Ativo':'Inativo'}</span></td><td>{usuario.trocar_senha?'Troca pendente':'Concluída'}</td><td><div className="users-actions"><button className="button secondary compact" onClick={()=>iniciarEdicao(usuario)}><Pencil size={14}/>Editar</button><button className="button secondary compact" onClick={()=>alternar(usuario)}>{usuario.ativo?'Desativar':'Ativar'}</button></div></td></tr>)}</tbody></table></div></div>
    {editando && <div className="user-modal-backdrop" onMouseDown={()=>setEditando(null)}><div className="user-modal panel" onMouseDown={e=>e.stopPropagation()}><div className="user-modal-title"><div><h2>Editar usuário</h2><span>{editando.login}</span></div><button className="icon-button" onClick={()=>setEditando(null)}><X size={18}/></button></div><div className="user-edit-grid"><label>Nome<input value={edicao.nome} onChange={e=>setEdicao({...edicao,nome:e.target.value})}/></label><label>Login<input value={edicao.login} onChange={e=>setEdicao({...edicao,login:e.target.value})}/></label><label>Perfil<select value={edicao.perfil} onChange={e=>setEdicao({...edicao,perfil:e.target.value})}>{PERFIS.map(p=><option key={p}>{p}</option>)}</select></label><label>Nova senha <small>(opcional)</small><input type="password" minLength={8} placeholder="Manter atual" value={edicao.senha} onChange={e=>setEdicao({...edicao,senha:e.target.value})}/></label></div><div className="user-modal-actions"><button className="button secondary" onClick={()=>setEditando(null)}><X size={15}/>Cancelar</button><button className="button primary" onClick={salvarEdicao} disabled={loading}><Save size={15}/>Salvar alterações</button></div></div></div>}
  </section>;
}
