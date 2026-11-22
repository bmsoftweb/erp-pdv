import { dataHoraSql } from './dataHora';

/**
 * Cliente do Agente CliSiTef (Software Express/Fiserv): serviço instalado no computador do caixa, ligado ao PinPad,
 * que expõe a CliSiTef em https://127.0.0.1/agente/clisitef. O navegador fala direto com ele (o servidor do PDV,
 * na nuvem, não alcança o PinPad). Fluxo: startTransaction → continueTransaction (coleta iterativa, enquanto
 * clisitefStatus = 10000) → finishTransaction, que confirma ou desfaz depois que a NFC-e sai.
 * ponytail: rotas e parâmetros conforme o exemplo do Agente; conferir com a especificação da Software Express na
 * homologação (ela só é liberada para a software house cadastrada).
 */
export const AGENTE = 'https://127.0.0.1/agente/clisitef';

/** Retorno da coleta iterativa: continua chamando continueTransaction */
export const CONTINUA = 10000;

/** Configuração do caixa (pdv_caixas.sitef_*) */
export interface ConfigSitef {
  ip: string;
  loja: string;
  terminal: string;
}

/** Documento fiscal vinculado às transações: o mesmo número, data e hora no início e na finalização */
export interface DocumentoTef {
  cupom: string;
  data: string; // AAAAMMDD
  hora: string; // HHMMSS
}

export interface RespostaAgente {
  serviceStatus: number;
  serviceMessage?: string;
  clisitefStatus: number;
  sessionId?: string;
  commandId?: number;
  fieldId?: number;
  fieldMinLength?: number;
  fieldMaxLength?: number;
  data?: string;
}

/** Função do SiTEF por meio de pagamento (tPag); fora daqui o cartão é lançado à mão */
export const FUNCAO_SITEF: Record<string, number> = {
  '03': 3, // crédito (à vista ou parcelado: o PinPad pergunta)
  '04': 2, // débito
  '10': 5, // vale alimentação (cartão benefício)
  '11': 5, // vale refeição (cartão benefício)
  '17': 122, // PIX (carteiras digitais)
};

/** Documento novo para a venda: o cupom do SiTEF tem até 20 caracteres (o id da venda tem 25) */
export function novoDocumento(idVenda: string): DocumentoTef {
  const [d, h] = dataHoraSql().split(' ');
  return { cupom: idVenda.slice(-20), data: d.replace(/-/g, ''), hora: h.replace(/:/g, '') };
}

const ERROS: Record<number, string> = {
  [-1]: 'Módulo SiTEF não inicializado.',
  [-2]: 'Operação cancelada pelo operador.',
  [-3]: 'Código de função inválido.',
  [-5]: 'Sem comunicação com o SiTEF.',
  [-6]: 'Operação cancelada pelo cliente no PinPad.',
  [-8]: 'A CliSiTef está desatualizada (função não implementada).',
  [-10]: 'Parâmetro obrigatório não informado.',
  [-12]: 'Erro na coleta: a transação anterior não terminou.',
  [-13]: 'Documento fiscal não encontrado na CliSiTef.',
  [-15]: 'Operação cancelada pelo PDV.',
  [-20]: 'Parâmetro inválido.',
  [-40]: 'Transação negada pelo SiTEF.',
  [-41]: 'Dados inválidos.',
  [-43]: 'Problema no PinPad.',
  [-50]: 'Transação não segura.',
  [-100]: 'Erro interno da CliSiTef.',
};

/** Texto do status final da CliSiTef (positivo = negada pelo autorizador) */
export function erroSitef(status: number): string {
  if (status > 0) return `Transação negada pelo autorizador (código ${status}).`;
  return ERROS[status] || `Erro ${status} da CliSiTef.`;
}

async function chamar(acao: string, campos: Record<string, string | number>): Promise<RespostaAgente> {
  let r: Response;
  try {
    r = await fetch(`${AGENTE}/${acao}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(Object.entries(campos).map(([k, v]) => [k, String(v)])),
    });
  } catch {
    throw new Error('O Agente CliSiTef não respondeu neste computador. Confira se ele está instalado e rodando, e abra https://127.0.0.1/agente/clisitef/state uma vez para o navegador aceitar o certificado dele.');
  }
  const d = (await r.json().catch(() => null)) as RespostaAgente | null;
  if (!r.ok || !d) throw new Error(`Agente CliSiTef: erro ${r.status}.`);
  if (Number(d.serviceStatus) !== 0) throw new Error(d.serviceMessage || `Agente CliSiTef: status ${d.serviceStatus}.`);
  return { ...d, clisitefStatus: Number(d.clisitefStatus), commandId: Number(d.commandId), fieldId: Number(d.fieldId) };
}

const config = (cfg: ConfigSitef) => ({ sitefIp: cfg.ip, storeId: cfg.loja, terminalId: cfg.terminal });
const documento = (doc: DocumentoTef) => ({ taxInvoiceNumber: doc.cupom, taxInvoiceDate: doc.data, taxInvoiceTime: doc.hora });

export const iniciar = (cfg: ConfigSitef, doc: DocumentoTef, funcao: number, valor: number, operador: string) =>
  chamar('startTransaction', {
    ...config(cfg),
    ...documento(doc),
    functionId: funcao,
    trnAmount: valor.toFixed(2).replace('.', ','),
    cashierOperator: operador.slice(0, 20),
    trnAdditionalParameters: '',
    trnInitParameters: '',
  });

/** continua: 0 = segue, 1 = volta ao passo anterior, -1 = encerra (cancela) */
export const continuar = (sessionId: string, data: string, continua: 0 | 1 | -1) => chamar('continueTransaction', { sessionId, data, continue: continua });

/** Imprime as vias do comprovante TEF (texto pronto da CliSiTef), uma por página */
export function imprimirComprovantes(vias: string[]) {
  if (!vias.length) return;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0';
  f.srcdoc = `<style>@page{margin:4mm}pre{font:12px monospace;margin:0}pre+pre{break-before:page}</style>${vias.map((v) => `<pre>${esc(v)}</pre>`).join('')}`;
  f.onload = () => {
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 60_000);
  };
  document.body.appendChild(f);
}

/** Confirma (NFC-e emitida) ou desfaz (cupom cancelado) todas as transações do documento */
export const finalizar = (cfg: ConfigSitef, doc: DocumentoTef, confirmar: boolean) =>
  chamar('finishTransaction', { ...config(cfg), ...documento(doc), confirm: confirmar ? 1 : 0 });
