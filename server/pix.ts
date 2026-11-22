import { Router } from 'express';
import { empresaDa } from './auth.js';
import { ErroHttp, falha, rota, tokenPara } from './notas.js';

/**
 * PIX cobrado no banco pelo BMBancos (API Pix do Bacen; BB, Itaú, Bradesco, Santander, Caixa, Sicoob, Sicredi...): cria a cobrança, o caixa mostra o QR Code e
 * consulta até o pagamento cair. As credenciais e o certificado do banco ficam só no BMBancos.
 *
 * Autenticação como no erp-nfe: token de sessão do BMBancos (HMAC com o SESSION_SECRET dele, aqui BANCOS_SECRET)
 * para o usuário logado; o BMBancos exige que a empresa da sessão seja a do usuário.
 */

const configurado = () => !!process.env.BANCOS_URL && (process.env.BANCOS_SECRET || '').length >= 32;

async function bancos(uid: number, empresa: number, caminho: string, corpo?: unknown) {
  if (!configurado()) falha('PIX pelo banco não configurado (BANCOS_URL e BANCOS_SECRET no .env).', 503);
  let r: Response;
  try {
    r = await fetch(`${process.env.BANCOS_URL!.replace(/\/$/, '')}/api${caminho}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPara(process.env.BANCOS_SECRET!, uid, empresa)}` },
      ...(corpo !== undefined && { body: JSON.stringify(corpo) }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e: any) {
    throw new ErroHttp(504, `Sem resposta do BMBancos (${e?.message ?? e}).`);
  }
  const d: any = await r.json().catch(() => ({}));
  if (r.status === 401) falha('O BMBancos recusou o acesso: o usuário precisa ser da empresa da sessão, e o BANCOS_SECRET igual ao SESSION_SECRET do BMBancos.', 502);
  if (!r.ok || !d.success) falha(d.error || `BMBancos: erro ${r.status}.`, 502);
  return d;
}

const TXID = /^[A-Za-z0-9]{26,35}$/;

export function createPixRouter() {
  const r = Router();

  /** O caixa usa a cobrança no banco quando o PDV está ligado ao BMBancos */
  r.get('/pix', rota(async () => ({ ativo: configurado() })));

  /** { valor, referencia } -> { contaId, cnpj (do banco que recebe, para a NFC-e), cobranca: { txid, status, valor, pixCopiaECola } } */
  r.post('/pix/cobrar', rota(async (req, res, s) => {
    const valor = Math.round(Number(req.body?.valor) * 100) / 100;
    if (!(valor > 0)) falha('Valor do PIX inválido.');
    const d = await bancos(s.userId!, empresaDa(res), '/pix/cobrancas', {
      valor,
      referencia: `PDV-${String(req.body?.referencia || '').slice(0, 50)}`,
      ...(s.caixaNumero && { descricao: `Caixa ${s.caixaNumero}` }),
    });
    return { contaId: d.contaId, cnpj: d.cnpj, cobranca: d.cobranca };
  }));

  const caminho = (p: Record<string, string>) => {
    if (!(Number(p.conta) > 0) || !TXID.test(p.txid)) falha('Cobrança PIX inválida.');
    return `/pix/cobrancas/${Number(p.conta)}/${p.txid}`;
  };

  r.get('/pix/:conta/:txid', rota(async (req, res, s) => ({ cobranca: (await bancos(s.userId!, empresaDa(res), caminho(req.params))).cobranca })));

  r.post('/pix/:conta/:txid/cancelar', rota(async (req, res, s) => ({ cobranca: (await bancos(s.userId!, empresaDa(res), `${caminho(req.params)}/cancelar`, {})).cobranca })));

  return r;
}
