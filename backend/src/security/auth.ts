import type { NextFunction, Request, Response } from 'express';
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getPool } from '../database/pool.js';

const scrypt = promisify(scryptCallback);
const TOKEN_TTL_SEGUNDOS = Math.max(900, Number(process.env.AUTH_TOKEN_TTL_SECONDS || 28800));
const TOKEN_CACHE_SEGUNDOS = Math.min(60, Math.max(0, Number(process.env.AUTH_TOKEN_VALIDATION_CACHE_SECONDS || 15)));
const TOKEN_CACHE_LIMITE = 1_000;
const db = getPool;

export type Perfil = 'ADMINISTRADOR' | 'FINANCEIRO' | 'AUDITOR' | 'OPERADOR' | 'CONSULTA';
type Usuario = { id: string; nome: string; login: string; perfil: Perfil; senha_hash: string; senha_salt: string; ativo: boolean; trocar_senha: boolean; versao_sessao: number; criado_em: string; atualizado_em: string };
export type UsuarioAutenticado = Pick<Usuario, 'id' | 'nome' | 'login' | 'perfil' | 'trocar_senha'>;
type TokenCacheItem = { usuario: UsuarioAutenticado; validoAte: number };

const tokensValidados = new Map<string, TokenCacheItem>();

declare global { namespace Express { interface Request { usuario?: UsuarioAutenticado } } }

function normalizarLogin(valor: unknown) { return String(valor || '').trim().toLowerCase(); }
function b64url(valor: Buffer | string) { return Buffer.from(valor).toString('base64url'); }
async function derivarSenha(senha: string, salt: string) { return (await scrypt(senha, salt, 64) as Buffer).toString('hex'); }
async function buscarUsuarios() { return (await db().query<Usuario>('SELECT * FROM usuarios ORDER BY criado_em')).rows; }
function invalidarCacheTokens() { tokensValidados.clear(); }
function obterTokenEmCache(token: string, agora: number) {
  const item = tokensValidados.get(token);
  if (!item) return null;
  if (item.validoAte <= agora) { tokensValidados.delete(token); return null; }
  return item.usuario;
}
function guardarTokenEmCache(token: string, usuario: UsuarioAutenticado, expiraEm: number) {
  if (TOKEN_CACHE_SEGUNDOS <= 0) return;
  const agora = Date.now();
  tokensValidados.set(token, { usuario, validoAte: Math.min(expiraEm, agora + TOKEN_CACHE_SEGUNDOS * 1_000) });
  if (tokensValidados.size <= TOKEN_CACHE_LIMITE) return;
  for (const [chave, item] of tokensValidados) {
    if (item.validoAte <= agora || tokensValidados.size > TOKEN_CACHE_LIMITE) tokensValidados.delete(chave);
    if (tokensValidados.size <= TOKEN_CACHE_LIMITE) break;
  }
}
function obterSegredo() {
  const segredo = String(process.env.AUTH_SECRET || '');
  if (segredo.length < 32 || segredo.startsWith('SUBSTITUA_')) throw new Error('AUTH_SECRET deve ser configurada com um segredo real de pelo menos 32 caracteres.');
  return segredo;
}

export async function inicializarSeguranca() {
  const total = Number((await db().query('SELECT COUNT(*)::int AS total FROM usuarios')).rows[0]?.total || 0);
  if (total) return;
  const senha = String(process.env.ADMIN_INITIAL_PASSWORD || '').trim();
  if (senha.length < 8 || senha.startsWith('SUBSTITUA_')) throw new Error('ADMIN_INITIAL_PASSWORD deve ser definida com uma senha temporária real de pelo menos 8 caracteres na primeira inicialização.');
  const salt = randomBytes(16).toString('hex');
  await db().query(`INSERT INTO usuarios (id,nome,login,perfil,senha_hash,senha_salt,ativo,trocar_senha) VALUES ($1,'Administrador','admin','ADMINISTRADOR',$2,$3,TRUE,TRUE)`, [randomUUID(), await derivarSenha(senha, salt), salt]);
  console.log('[seguranca] Usuário administrador inicial criado; troca obrigatória no primeiro acesso.');
}

async function emitirToken(usuario: Usuario) {
  const agora = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: usuario.id, sv: usuario.versao_sessao, iat: agora, exp: agora + TOKEN_TTL_SEGUNDOS }));
  return `${payload}.${createHmac('sha256', obterSegredo()).update(payload).digest('base64url')}`;
}

async function validarToken(token: string): Promise<UsuarioAutenticado | null> {
  const [payload, assinatura] = token.split('.'); if (!payload || !assinatura) return null;
  const esperada = createHmac('sha256', obterSegredo()).update(payload).digest();
  let recebida: Buffer; try { recebida = Buffer.from(assinatura, 'base64url'); } catch { return null; }
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  let dados: any; try { dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!dados.exp || dados.exp < Math.floor(Date.now() / 1000)) return null;
  const usuarioEmCache = obterTokenEmCache(token, Date.now());
  if (usuarioEmCache) return usuarioEmCache;
  const usuario = (await db().query<Usuario>('SELECT * FROM usuarios WHERE id=$1 AND ativo=TRUE AND versao_sessao=$2', [dados.sub, dados.sv])).rows[0];
  if (!usuario) return null;
  const usuarioSeguro = { id: usuario.id, nome: usuario.nome, login: usuario.login, perfil: usuario.perfil, trocar_senha: usuario.trocar_senha };
  guardarTokenEmCache(token, usuarioSeguro, Number(dados.exp) * 1_000);
  return usuarioSeguro;
}

export async function login(loginInformado: unknown, senha: unknown) {
  const usuario = (await db().query<Usuario>('SELECT * FROM usuarios WHERE login=$1 AND ativo=TRUE', [normalizarLogin(loginInformado)])).rows[0];
  if (!usuario || !String(senha || '')) return null;
  const calculada = Buffer.from(await derivarSenha(String(senha), usuario.senha_salt), 'hex'); const cadastrada = Buffer.from(usuario.senha_hash, 'hex');
  if (calculada.length !== cadastrada.length || !timingSafeEqual(calculada, cadastrada)) return null;
  const seguro = { id: usuario.id, nome: usuario.nome, login: usuario.login, perfil: usuario.perfil, trocar_senha: usuario.trocar_senha };
  return { token: await emitirToken(usuario), usuario: seguro, expira_em_segundos: TOKEN_TTL_SEGUNDOS };
}

export async function alterarPropriaSenha(usuarioId: string, atual: unknown, nova: unknown) {
  const senhaNova = String(nova || ''); if (senhaNova.length < 8) throw new Error('A nova senha deve ter pelo menos 8 caracteres.');
  const usuario = (await db().query<Usuario>('SELECT * FROM usuarios WHERE id=$1', [usuarioId])).rows[0]; if (!usuario) throw new Error('Usuário não encontrado.');
  const atualHash = Buffer.from(await derivarSenha(String(atual || ''), usuario.senha_salt), 'hex'); const cadastrado = Buffer.from(usuario.senha_hash, 'hex');
  if (atualHash.length !== cadastrado.length || !timingSafeEqual(atualHash, cadastrado)) throw new Error('Senha atual incorreta.');
  const salt = randomBytes(16).toString('hex');
  await db().query('UPDATE usuarios SET senha_hash=$1,senha_salt=$2,trocar_senha=FALSE,versao_sessao=versao_sessao+1,atualizado_em=NOW() WHERE id=$3', [await derivarSenha(senhaNova, salt), salt, usuarioId]);
  invalidarCacheTokens();
}

export async function autenticar(req: Request, res: Response, next: NextFunction) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const usuario = token ? await validarToken(token) : null;
    if (!usuario) return res.status(401).json({ sucesso: false, codigo: 'NAO_AUTENTICADO', mensagem: 'Sessão ausente, inválida ou expirada.' });
    req.usuario = usuario;
    next();
  } catch (error) {
    console.error('[autenticacao] Banco temporariamente indisponível:', error instanceof Error ? error.message : String(error));
    if (!res.headersSent) {
      return res.status(503).json({
        sucesso: false,
        codigo: 'BANCO_TEMPORARIAMENTE_INDISPONIVEL',
        mensagem: 'O banco de dados está ocupado. Tente novamente em alguns segundos.',
      });
    }
    next(error);
  }
}
const escrita: Perfil[]=['ADMINISTRADOR','FINANCEIRO','OPERADOR'];
export function autorizar(perfis:Perfil[]){return(req:Request,res:Response,next:NextFunction)=>perfis.includes(req.usuario!.perfil)?next():res.status(403).json({sucesso:false,codigo:'ACESSO_NEGADO',mensagem:'Seu perfil não possui permissão para esta operação.'});}
export function exigirEscrita(req:Request,res:Response,next:NextFunction){return autorizar(escrita)(req,res,next);}
export function exigirAdmin(req:Request,res:Response,next:NextFunction){return autorizar(['ADMINISTRADOR'])(req,res,next);}
export async function auditar(req:Request,status:number,detalhes?:unknown){await db().query('INSERT INTO auditoria_seguranca (id,usuario_id,login,perfil,metodo,rota,ip,status,detalhes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[randomUUID(),req.usuario?.id||null,req.usuario?.login||null,req.usuario?.perfil||null,req.method,req.originalUrl.split('?')[0],req.ip,status,JSON.stringify(detalhes||null)]);}
export function middlewareAuditoria(req:Request,res:Response,next:NextFunction){if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();res.on('finish',()=>{void auditar(req,res.statusCode).catch((error)=>console.error('[auditoria] Falha ao registrar evento:',error instanceof Error?error.message:String(error)));});next();}
export function perfisDeEscrita(){return escrita;}
export async function listarUsuariosSeguros(){return (await buscarUsuarios()).map(({senha_hash:_h,senha_salt:_s,...u})=>u);}
export async function criarUsuario(input:any){const loginUsuario=normalizarLogin(input.login),senha=String(input.senha||'');const perfis:Perfil[]=['ADMINISTRADOR','FINANCEIRO','AUDITOR','OPERADOR','CONSULTA'];if(!loginUsuario.match(/^[a-z0-9._-]{3,40}$/))throw new Error('Login inválido.');if(senha.length<8)throw new Error('A senha temporária deve ter pelo menos 8 caracteres.');if(!perfis.includes(input.perfil))throw new Error('Perfil inválido.');const salt=randomBytes(16).toString('hex'),id=randomUUID();try{await db().query('INSERT INTO usuarios (id,nome,login,perfil,senha_hash,senha_salt) VALUES ($1,$2,$3,$4,$5,$6)',[id,String(input.nome||'').trim()||loginUsuario,loginUsuario,input.perfil,await derivarSenha(senha,salt),salt]);}catch(e:any){if(e.code==='23505')throw new Error('Este login já está cadastrado.');throw e;}return (await listarUsuariosSeguros()).find(u=>u.id===id);}
export async function atualizarUsuario(id:string,input:any,executorId:string){
  const atual=(await db().query<Usuario>('SELECT * FROM usuarios WHERE id=$1',[id])).rows[0];
  if(!atual)throw new Error('Usuário não encontrado.');
  if(id===executorId&&input.ativo===false)throw new Error('Você não pode desativar seu próprio usuário.');
  const perfis:Perfil[]=['ADMINISTRADOR','FINANCEIRO','AUDITOR','OPERADOR','CONSULTA'];
  const perfil=input.perfil||atual.perfil;
  if(!perfis.includes(perfil))throw new Error('Perfil inválido.');
  const nome=input.nome!==undefined?String(input.nome).trim():atual.nome;
  const loginUsuario=input.login!==undefined?normalizarLogin(input.login):atual.login;
  if(!loginUsuario.match(/^[a-z0-9._-]{3,40}$/))throw new Error('Login inválido.');
  const ativo=input.ativo!==undefined?Boolean(input.ativo):atual.ativo;
  const senha=String(input.senha||'');
  if(senha&&senha.length<8)throw new Error('A nova senha deve ter pelo menos 8 caracteres.');
  try{
    if(senha){
      const salt=randomBytes(16).toString('hex');
      await db().query('UPDATE usuarios SET nome=$1,login=$2,perfil=$3,ativo=$4,senha_hash=$5,senha_salt=$6,trocar_senha=TRUE,versao_sessao=versao_sessao+1,atualizado_em=NOW() WHERE id=$7',[nome,loginUsuario,perfil,ativo,await derivarSenha(senha,salt),salt,id]);
    }else{
      await db().query('UPDATE usuarios SET nome=$1,login=$2,perfil=$3,ativo=$4,versao_sessao=CASE WHEN login<>$2 OR perfil<>$3 OR ativo<>$4 THEN versao_sessao+1 ELSE versao_sessao END,atualizado_em=NOW() WHERE id=$5',[nome,loginUsuario,perfil,ativo,id]);
    }
  }catch(e:any){if(e.code==='23505')throw new Error('Este login já está cadastrado.');throw e;}
  invalidarCacheTokens();return (await listarUsuariosSeguros()).find(u=>u.id===id);
}
