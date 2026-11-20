import { SessionOptions } from 'iron-session';

export interface SessionData {
  userId?: number;
  userName?: string;
  /** Filial escolhida no login (sys_empresas.id) */
  empresaId?: number;
  empresaNome?: string;
  /** Grupo da filial (sys_grupos.id): os produtos são do grupo */
  grupoId?: number;
  grupoNome?: string;
  perfil?: string;
  isLoggedIn: boolean;
}

// Sem segredo no .env o app não sobe: um valor padrão no código permitiria forjar o cookie de sessão
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  throw new Error('SESSION_SECRET não definido (ou com menos de 32 caracteres) no .env.');
}

export const sessionOptions: SessionOptions = {
  password: secret,
  cookieName: 'bm_pdv_sessao',
  cookieOptions: {
    secure: true, // MUST be true for SameSite=None
    sameSite: 'none', // Required for cross-origin iframe (Master)
    httpOnly: true,
    path: '/',
  },
};
