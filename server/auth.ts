import { Router, Request, Response, NextFunction } from 'express';
import { getIronSession } from 'iron-session';
import { abrirSessao, autenticar, ErroAcesso } from './acessoErp.js';
import { conferirCaixa, SEM_REGISTRO } from './caixas.js';
import { sessionOptions, SessionData } from './session.js';

/**
 * Entrada vinda do Master (lançador de módulos), sem a tela de login:
 *   GET /api/entrar?user=base64(login:senha)&e=<empresa>&volta=<endereço do Master>
 * Confere o usuário e a filial como o login e abre a sessão. Deu certo: vai para o PDV. Deu erro (usuário
 * inativo, senha trocada, filial não liberada…): volta para o Master com ?erro=<mensagem>.
 * O endereço de volta só é aceito se for o do Master (MASTER_URL no .env, separado por vírgula; sem ele, localhost),
 * para o link não servir de redirecionamento para outro site.
 */
function voltaPermitida(v: string | null): URL | null {
  if (!v) return null;
  try {
    const url = new URL(v);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const permitidas = (process.env.MASTER_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = permitidas.length ? permitidas.some((p) => new URL(p).origin === url.origin) : ['localhost', '127.0.0.1'].includes(url.hostname);
    return ok ? url : null;
  } catch {
    return null;
  }
}

export function createAuthRouter() {
  const router = Router();

  router.get('/entrar', async (req: Request, res: Response) => {
    const q = new URL(req.originalUrl, 'http://localhost').searchParams;
    const volta = voltaPermitida(q.get('volta'));
    try {
      const credencial = Buffer.from(q.get('user') || '', 'base64').toString('utf8');
      const i = credencial.indexOf(':');
      if (i < 1) throw new ErroAcesso(400, 'Acesso inválido: abra o módulo pelo Master.');
      const { u, filiais } = await autenticar(credencial.slice(0, i).trim(), credencial.slice(i + 1));
      // Só entra pelo computador registrado num caixa, na filial do caixa (o "e" do Master não vale aqui)
      const { filial, caixa } = await conferirCaixa(req, res, u, filiais);
      await abrirSessao(req, res, u, filial, caixa);
      // master=1: ao Sair, fecha a aba do Master (lib/origemMaster.ts)
      return res.redirect(302, '/?master=1');
    } catch (err: any) {
      // Computador sem registro válido: abre a tela de login do PDV, que pede o token do caixa
      if (err instanceof ErroAcesso && err.status === SEM_REGISTRO) return res.redirect(302, '/?master=1');
      const mensagem = err instanceof ErroAcesso ? err.message : 'Erro ao entrar no PDV. Tente novamente.';
      if (!(err instanceof ErroAcesso)) console.error('Entrada pelo Master:', err);
      if (volta) {
        volta.searchParams.set('erro', `PDV: ${mensagem}`);
        return res.redirect(302, volta.toString());
      }
      return res.status(err instanceof ErroAcesso ? err.status : 500).type('text/plain; charset=utf-8').send(mensagem);
    }
  });

  router.post('/login', async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const login = String(body?.login || '').trim();
      const senha = typeof body?.senha === 'string' ? body.senha : '';
      const { u, filiais } = await autenticar(login, senha);

      // Só entra pelo computador registrado num caixa, na filial do caixa
      const { filial, caixa } = await conferirCaixa(req, res, u, filiais);
      await abrirSessao(req, res, u, filial, caixa);
      return res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ErroAcesso) return res.status(error.status).json({ error: error.message });
      console.error('Login error:', error);
      return res.status(500).json({ error: 'Erro interno do servidor: ' + error.message });
    }
  });

  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      session.destroy();
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/user', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn || session.caixaId == null) return res.status(401).json({ isLoggedIn: false });
      return res.json(session);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}

/** Daqui em diante a API exige sessão; a sessão fica em res.locals.sessao para as rotas */
export async function exigirSessao(req: Request, res: Response, next: NextFunction) {
  try {
    const s = await getIronSession<SessionData>(req, res, sessionOptions);
    // Sessão sem caixa (aberta antes da regra do computador registrado) também não vale
    if (!s.isLoggedIn || s.caixaId == null) return void res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    res.locals.sessao = s;
    next();
  } catch (e) {
    next(e);
  }
}

/** Grupo da sessão (sys_grupos.id): os produtos são do grupo */
export const grupoDa = (res: Response): number => Number((res.locals.sessao as SessionData).grupoId ?? 1);

/** Filial da sessão (sys_empresas.id): os cupons (mov_nfce) são da filial. A 0 é a de demonstração: por isso ?? e não || */
export const empresaDa = (res: Response): number => Number((res.locals.sessao as SessionData).empresaId ?? 1);
