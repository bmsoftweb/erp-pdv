import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { pool } from './db.js';
import { ErroAcesso, type Filial } from './acessoErp.js';
import { sessionOptions, terminalOptions, type SessionData, type TerminalData } from './session.js';
import { dataHoraSql } from '../lib/dataHora.js';

// Caixas do PDV (pdv_caixas, extras/2026-11-20_pdv_caixas.sql), cadastrados no ERP-Master. Cada computador é
// registrado num caixa com o token do cadastro (cookie lacrado bm_pdv_terminal). Computador registrado só entra na
// filial do caixa e, se o caixa tiver usuário, só com ele; usuário amarrado a um caixa só entra pelo computador dele.

// Token NNNN-NNNN gerado pelo ERP-Master (Configurações da empresa → Caixas (PDV)).
// ponytail: sem limite de tentativas no registro; o token sozinho não entra (o login ainda pede usuário e senha).
// Se precisar, contar erros por IP no POST /caixa-local.

/** Token digitado → NNNN-NNNN (aceita sem o traço ou com espaços); '' quando não tem 8 dígitos */
export function normalizarToken(t: unknown): string {
  const s = String(t ?? '').replace(/[\s.-]/g, '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : '';
}

const SQL_CAIXA = `
  SELECT c.*,
         COALESCE(NULLIF(e.nome_fantasia, ''), e.razao_social) AS empresa_nome, u.login
    FROM pdv_caixas c
    JOIN sys_empresas e ON e.id = c.empresa_id
    LEFT JOIN sys_usuarios u ON u.id = c.usuario_id`;

/** Tabela ainda não criada: o PDV segue sem caixas (todos os computadores livres) */
const semTabela = (e: any) => e?.code === 'ER_NO_SUCH_TABLE';

const resumo = (c: any) => ({
  numero: Number(c.numero),
  descricao: c.descricao as string,
  empresaNome: c.empresa_nome as string,
  login: (c.login as string) || null,
  /** Tela touch (pdv_caixas.teclado_virtual, extras/2026-11-21_pdv_caixas_teclado.sql); null antes de a coluna existir */
  tecladoVirtual: c.teclado_virtual == null ? null : Number(c.teclado_virtual) === 1,
  /** Balança (pdv_caixas.balanca*, extras/2026-11-21_pdv_caixas_balanca.sql); null = caixa sem balança */
  balanca: Number(c.balanca) === 1 ? { velocidade: Number(c.balanca_velocidade) || 2400, formato: String(c.balanca_formato || '8N1') } : null,
});

const ipDe = (req: Request) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 45);

/** Status do erro "computador sem registro válido": a entrada pelo Master manda para a tela de registro */
export const SEM_REGISTRO = 428;

/** Caixa registrado neste computador (null sem registro). Registro que não vale mais (inativo, token trocado) é erro */
async function caixaDoComputador(req: Request, res: Response) {
  const t = await getIronSession<TerminalData>(req, res, terminalOptions);
  if (!t.caixaId) return { t, caixa: null };
  const [[c]]: any = await pool.query(`${SQL_CAIXA} WHERE c.id = ?`, [t.caixaId]);
  if (!c || !c.ativo || c.token !== t.token) {
    throw new ErroAcesso(SEM_REGISTRO, 'O registro deste computador não vale mais (caixa desativado ou token trocado). Registre de novo com o token do caixa.');
  }
  return { t, caixa: c };
}

/**
 * Regras do caixa no login (tela e Master), depois de conferir a senha. Só entra computador registrado num caixa
 * ativo: devolve o caixa e a filial dele. Com usuário no caixa, só ele; usuário amarrado a caixas, só pelos dele.
 */
export async function conferirCaixa(req: Request, res: Response, u: any, filiais: Filial[]): Promise<{ filial: Filial; caixa: any }> {
  let registro;
  try {
    registro = await caixaDoComputador(req, res);
  } catch (e) {
    if (semTabela(e)) throw new ErroAcesso(500, 'Falta criar a tabela pdv_caixas (extras/2026-11-20_pdv_caixas.sql).');
    throw e;
  }
  const { t, caixa } = registro;
  if (!caixa) throw new ErroAcesso(SEM_REGISTRO, 'Este computador não está registrado em nenhum caixa. Registre com o token do caixa (ERP-Master → Empresas → Configurações → Caixas (PDV)).');
  if (caixa.usuario_id != null && Number(caixa.usuario_id) !== Number(u.id)) {
    throw new ErroAcesso(403, `Este computador é o caixa ${caixa.numero} e só aceita o usuário ${caixa.login}.`);
  }
  const [proprios]: any = await pool.query('SELECT id, numero FROM pdv_caixas WHERE usuario_id = ? AND ativo = 1 ORDER BY numero', [u.id]);
  if (proprios.length && !proprios.some((p: any) => Number(p.id) === Number(caixa.id))) {
    throw new ErroAcesso(403, `O usuário ${u.login} só entra pelo computador do caixa ${proprios.map((p: any) => p.numero).join(', ')}.`);
  }
  const filial = filiais.find((f) => Number(f.id) === Number(caixa.empresa_id));
  if (!filial) throw new ErroAcesso(403, `Este computador é o caixa ${caixa.numero} de ${caixa.empresa_nome}, filial não liberada para ${u.login}.`);
  await t.save(); // renova a validade do cookie
  await pool.query('UPDATE pdv_caixas SET ultimo_acesso = ?, ultimo_usuario_id = ?, ultimo_ip = ? WHERE id = ?', [dataHoraSql(), u.id, ipDe(req), caixa.id]);
  return { filial, caixa };
}

/** Rotas sem sessão: a tela de login mostra e registra o caixa deste computador */
export function createCaixaLocalRouter() {
  const r = Router();

  r.get('/caixa-local', async (req, res) => {
    try {
      const { caixa } = await caixaDoComputador(req, res);
      res.json({ caixa: caixa && resumo(caixa) });
    } catch (e: any) {
      if (semTabela(e)) return void res.json({ caixa: null });
      if (e instanceof ErroAcesso) return void res.json({ caixa: null, erro: e.message });
      console.error('Caixa local:', e);
      res.status(500).json({ error: 'Erro ao ler o caixa deste computador.' });
    }
  });

  // O token é a autorização e vale para um computador só: o primeiro registro o consome (registrado_em). Para outro
  // computador (ou o mesmo, depois de limpar o navegador), o ERP-Master gera um token novo, que zera o registrado_em.
  r.post('/caixa-local', async (req, res) => {
    try {
      const token = normalizarToken(req.body?.token);
      if (!token) return void res.status(400).json({ error: 'Token inválido: são 8 números (NNNN-NNNN).' });
      const [[c]]: any = await pool.query(`${SQL_CAIXA} WHERE c.token = ? AND c.ativo = 1`, [token]);
      if (!c) return void res.status(404).json({ error: 'Token não encontrado ou caixa inativo.' });
      // Condicional no UPDATE: dois computadores registrando ao mesmo tempo, só um consome o token
      const [uso]: any = await pool.query('UPDATE pdv_caixas SET registrado_em = ? WHERE id = ? AND token = ? AND registrado_em IS NULL', [dataHoraSql(), c.id, token]);
      if (!uso.affectedRows) {
        return void res.status(409).json({ error: `Este token já foi usado no computador do caixa ${c.numero}. Para registrar outro computador, gere um token novo no ERP-Master (Empresas → Configurações → Caixas (PDV)).` });
      }
      const t = await getIronSession<TerminalData>(req, res, terminalOptions);
      t.caixaId = Number(c.id);
      t.token = token;
      await t.save();
      // Quem estava logado entrou sem as regras do caixa: entra de novo
      (await getIronSession<SessionData>(req, res, sessionOptions)).destroy();
      res.json({ caixa: resumo(c) });
    } catch (e: any) {
      console.error('Registrar caixa:', e);
      res.status(500).json({ error: semTabela(e) ? 'Falta criar a tabela pdv_caixas (extras/2026-11-20_pdv_caixas.sql).' : 'Erro ao registrar o computador.' });
    }
  });

  return r;
}

/**
 * SiTEF do caixa da sessão (colunas sitef_* de pdv_caixas, extras/2026-11-20_pdv_caixas_sitef.sql). SELECT * para
 * funcionar antes de as colunas existirem: sem elas (ou vazias), null e o cartão segue lançado à mão.
 */
export function createCaixaSitefRouter() {
  const r = Router();
  r.get('/caixa/sitef', async (_req, res) => {
    try {
      const s = res.locals.sessao as SessionData;
      const [[c]]: any = s.caixaId ? await pool.query('SELECT * FROM pdv_caixas WHERE id = ?', [s.caixaId]) : [[]];
      const [ip, loja, terminal] = ['sitef_ip', 'sitef_loja', 'sitef_terminal'].map((k) => String(c?.[k] ?? '').trim());
      res.json({ sitef: ip && loja && terminal ? { ip, loja, terminal } : null });
    } catch (e: any) {
      if (semTabela(e)) return void res.json({ sitef: null });
      console.error('SiTEF do caixa:', e);
      res.status(500).json({ error: 'Erro ao ler a configuração do SiTEF do caixa.' });
    }
  });
  return r;
}
