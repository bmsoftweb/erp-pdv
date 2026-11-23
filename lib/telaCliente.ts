import { useEffect } from 'react';

/**
 * Tela do cliente: segunda janela do PDV (/?tela=cliente), no monitor virado para o cliente, que só mostra o cupom.
 * As duas janelas conversam pelo BroadcastChannel do navegador: sem servidor e sem internet (vale no caixa offline).
 */

export interface ItemCliente {
  nome: string;
  quantidade: number;
  /** Sigla da unidade do cadastro (KG…); null antes de a sincronização trazer */
  unidade?: string | null;
  /** Preço unitário de tabela (o valor já traz desconto/acréscimo do item) */
  preco: number;
  valor: number;
}

export interface EstadoCliente {
  empresa: string;
  itens: ItemCliente[];
  /** Desconto (−) ou acréscimo (+) no total */
  ajuste: number;
  total: number;
  /** Finalizando o cupom: pagamentos lançados */
  finalizando: boolean;
  pago: number;
  troco: number;
  /** Consumidor identificado: o nome do cadastro ou, sem cadastro, o CPF/CNPJ */
  cliente?: string | null;
  /** Associado do clube de descontos: os itens já vêm com o preço do clube */
  clube?: boolean;
}

/**
 * PIX em cobrança: o copia e cola (vira QR Code na tela do cliente); null tira o QR.
 * CPF na nota: o caixa pede (pedirCpf) ou desiste (cancelarCpf); o cliente responde com o CPF ou null (sem CPF).
 */
type Mensagem =
  | { tipo: 'estado'; estado: EstadoCliente }
  | { tipo: 'pix'; copiaECola: string | null; valor: number }
  | { tipo: 'ola' }
  | { tipo: 'pedirCpf' }
  | { tipo: 'cancelarCpf' }
  | { tipo: 'cpf'; cpf: string | null };

const CANAL = 'pdv-tela-cliente';
const JANELA = 'pdv-tela-cliente';
const LEMBRAR = 'pdv_tela_cliente';

const canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CANAL) : null;
const enviar = (m: Mensagem) => canal?.postMessage(m);

export const ehTelaCliente = () => new URLSearchParams(location.search).get('tela') === 'cliente';

/** Escuta o canal (os dois lados) */
export function useCanalCliente(aoReceber: (m: Mensagem) => void, deps: unknown[] = []) {
  useEffect(() => {
    if (!canal) return;
    const ouvir = (e: MessageEvent<Mensagem>) => aoReceber(e.data);
    canal.addEventListener('message', ouvir);
    return () => canal.removeEventListener('message', ouvir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Operador: manda o cupom a cada mudança e de novo quando a tela do cliente abre (ela pede com "ola") */
export function usePublicarCupom(estado: EstadoCliente) {
  const json = JSON.stringify(estado);
  useEffect(() => {
    enviar({ tipo: 'estado', estado });
  }, [json]); // eslint-disable-line react-hooks/exhaustive-deps
  useCanalCliente((m) => m.tipo === 'ola' && enviar({ tipo: 'estado', estado }), [json]);
}

/** Janela do PIX (banco ou TEF): mostra o QR Code ao cliente enquanto a cobrança está aberta */
export function usePixNoCliente(copiaECola: string | null | undefined, valor: number) {
  useEffect(() => {
    if (!copiaECola) return;
    enviar({ tipo: 'pix', copiaECola, valor });
    return () => enviar({ tipo: 'pix', copiaECola: null, valor: 0 });
  }, [copiaECola, valor]);
}

export const pedirEstado = () => enviar({ tipo: 'ola' });
export const pedirCpfAoCliente = () => enviar({ tipo: 'pedirCpf' });
export const cancelarCpfNoCliente = () => enviar({ tipo: 'cancelarCpf' });
export const responderCpf = (cpf: string | null) => enviar({ tipo: 'cpf', cpf });

/** Tela do cliente ligada neste computador: reabre sozinha ao iniciar o caixa */
export function telaClienteLembrada() {
  try {
    return localStorage.getItem(LEMBRAR) === '1';
  } catch {
    return false;
  }
}

/**
 * Abre (ou traz de volta) a janela do cliente. Precisa de um clique ou tecla do operador (bloqueio de pop-up).
 * No Chrome/Edge, com a permissão de "gerenciamento de janelas", abre direto no outro monitor.
 */
export async function abrirTelaCliente() {
  let posicao = 'width=1024,height=768';
  try {
    const w = window as any;
    if (w.getScreenDetails) {
      const telas = await w.getScreenDetails();
      const outra = telas.screens.find((s: any) => s !== telas.currentScreen);
      if (outra) posicao = `left=${outra.availLeft},top=${outra.availTop},width=${outra.availWidth},height=${outra.availHeight}`;
    }
  } catch {
    /* sem permissão: abre ao lado, e o operador arrasta para o outro monitor */
  }
  const janela = window.open('/?tela=cliente', JANELA, `popup,${posicao}`);
  aberta = janela;
  try {
    localStorage.setItem(LEMBRAR, janela ? '1' : '0');
  } catch {
    /* não lembra */
  }
  return !!janela;
}

let aberta: Window | null = null;

export function fecharTelaCliente() {
  // Depois de recarregar o PDV a referência se perde: pelo nome, o navegador devolve a janela que já existe
  (aberta && !aberta.closed ? aberta : window.open('', JANELA))?.close();
  aberta = null;
  try {
    localStorage.setItem(LEMBRAR, '0');
  } catch {
    /* não lembra */
  }
}
