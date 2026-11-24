import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft, Delete, Keyboard, ChevronDown } from 'lucide-react';

/**
 * Teclado virtual para telas touch sem teclado físico. Montado uma vez na raiz (como a Dica).
 *
 * Cada tecla age como a tecla física: primeiro um keydown no campo com foco (os atalhos do PDV, o Enter
 * que passa de campo, o Esc que fecha, os números dos menus e das confirmações funcionam igual); se ninguém
 * tratou (preventDefault), faz o efeito padrão: insere o caractere, apaga, ou envia o formulário no Enter.
 * As teclas não tiram o foco do campo. Campo numérico mostra só o teclado numérico.
 */

/** Escolha à mão (menu "Mais", login): vale até fechar o navegador */
const CHAVE_SESSAO = 'pdv_teclado_virtual';
/** Do cadastro do caixa (pdv_caixas.teclado_virtual), guardada para abrir certo mesmo sem conexão */
const CHAVE_CAIXA = 'pdv_teclado_caixa';
const EVENTO = 'pdv:teclado-virtual';

const ler = (armazenamento: () => Storage, chave: string) => {
  try {
    return armazenamento().getItem(chave);
  } catch {
    return null;
  }
};

/**
 * Ligado neste computador: a escolha à mão desta sessão; sem ela, o cadastro do caixa (ERP-Master); sem caixa
 * (ou antes da coluna existir), liga sozinho em tela só de toque (sem mouse).
 */
export function tecladoLigado(): boolean {
  const v = ler(() => sessionStorage, CHAVE_SESSAO) ?? ler(() => localStorage, CHAVE_CAIXA);
  if (v !== null) return v === '1';
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

export function ligarTeclado(ligar: boolean) {
  try {
    sessionStorage.setItem(CHAVE_SESSAO, ligar ? '1' : '0');
  } catch {
    /* sem armazenamento: não guarda */
  }
  window.dispatchEvent(new Event(EVENTO));
}

/** Lê a configuração do caixa deste computador (rota sem login): ao carregar a página e a cada login (tela de venda) */
export function lerDoCaixa() {
  fetch('/api/caixa-local')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const v = d?.caixa?.tecladoVirtual;
      if (typeof v !== 'boolean') return;
      try {
        localStorage.setItem(CHAVE_CAIXA, v ? '1' : '0');
      } catch {
        /* vale a detecção */
      }
      window.dispatchEvent(new Event(EVENTO));
    })
    .catch(() => {}); // sem conexão: vale a última configuração guardada
}

type Campo = HTMLInputElement | HTMLTextAreaElement;

const NAO_TEXTO = /^(checkbox|radio|button|submit|reset|file|color|range|image|hidden)$/;
function campoDe(el: Element | null): Campo | null {
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NAO_TEXTO.test(el.type))) {
    return el.disabled || el.readOnly ? null : el;
  }
  return null;
}

/** inputmode original (antes de virar "none" para o teclado do sistema não abrir junto) */
const modoOriginal = (c: Campo) => c.dataset.tecladoModo ?? c.getAttribute('inputmode') ?? '';
const numerico = (c: Campo | null) =>
  !!c && (/^(numeric|decimal|tel)$/.test(modoOriginal(c)) || (c instanceof HTMLInputElement && /^(number|tel)$/.test(c.type)));

function esconderTecladoDoSistema(c: Campo) {
  if (c.dataset.tecladoModo !== undefined) return;
  c.dataset.tecladoModo = c.getAttribute('inputmode') ?? '';
  c.setAttribute('inputmode', 'none');
}
function devolverTecladoDoSistema(c: Element | null) {
  const campo = campoDe(c);
  if (!campo || campo.dataset.tecladoModo === undefined) return;
  if (campo.dataset.tecladoModo) campo.setAttribute('inputmode', campo.dataset.tecladoModo);
  else campo.removeAttribute('inputmode');
  delete campo.dataset.tecladoModo;
}

/** Troca o valor como a digitação faria: o React (onChange) percebe pelo evento input */
function definirValor(c: Campo, valor: string, cursor: number) {
  const proto = c instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(c, valor);
  c.dispatchEvent(new Event('input', { bubbles: true }));
  try {
    c.setSelectionRange(cursor, cursor);
  } catch {
    /* tipos sem seleção (number) */
  }
}

function selecao(c: Campo): [number, number] {
  try {
    if (c.selectionStart !== null && c.selectionEnd !== null) return [c.selectionStart, c.selectionEnd];
  } catch {
    /* tipos sem seleção */
  }
  return [c.value.length, c.value.length];
}

/** Uma tecla: keydown no foco; sem tratamento, o efeito padrão */
function teclar(tecla: string) {
  const alvo = (document.activeElement as HTMLElement | null) ?? document.body;
  const ev = new KeyboardEvent('keydown', { key: tecla, bubbles: true, cancelable: true });
  alvo.dispatchEvent(ev);
  const c = campoDe(alvo);
  if (ev.defaultPrevented || !c) return;
  const [ini, fim] = selecao(c);
  if (tecla === 'Backspace') {
    const de = ini === fim ? Math.max(0, ini - 1) : ini;
    definirValor(c, c.value.slice(0, de) + c.value.slice(fim), de);
  } else if (tecla === 'Enter') {
    if (c instanceof HTMLTextAreaElement) definirValor(c, c.value.slice(0, ini) + '\n' + c.value.slice(fim), ini + 1);
    else c.form?.requestSubmit();
  } else if (tecla.length === 1 || tecla === '00') {
    const novo = c.value.slice(0, ini) + tecla + c.value.slice(fim);
    if (c.maxLength > 0 && novo.length > c.maxLength) return;
    definirValor(c, novo, ini + tecla.length);
  }
}

const LETRAS = ['qwertyuiop', 'asdfghjklç', 'zxcvbnm,.-'];
const NUMEROS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', ','];

const TECLA = 'h-11 rounded-lg bg-white border border-stone-300 shadow-xs text-lg font-semibold text-stone-800 active:bg-blue-100 active:border-blue-400 flex items-center justify-center cursor-pointer select-none touch-manipulation';
const TECLA_FUNCAO = `${TECLA} !bg-stone-100 text-sm`;

export function TecladoVirtual() {
  const [ligado, setLigado] = useState(tecladoLigado);
  const [recolhido, setRecolhido] = useState(false);
  const [campo, setCampo] = useState<Campo | null>(() => campoDe(document.activeElement));
  const [maiusculas, setMaiusculas] = useState(true);
  const caixa = useRef<HTMLDivElement>(null);
  const aberto = ligado && !recolhido;

  useEffect(() => {
    const mudou = () => setLigado(tecladoLigado());
    lerDoCaixa();
    window.addEventListener(EVENTO, mudou);
    return () => window.removeEventListener(EVENTO, mudou);
  }, []);

  // Acompanha o campo com foco (define o teclado numérico ou completo e esconde o teclado do sistema)
  useEffect(() => {
    const entrou = (e: FocusEvent) => {
      const c = campoDe(e.target as Element);
      if (c && aberto) esconderTecladoDoSistema(c);
      setCampo(c);
    };
    const saiu = (e: FocusEvent) => {
      devolverTecladoDoSistema(e.target as Element);
      setCampo(null);
    };
    document.addEventListener('focusin', entrou);
    document.addEventListener('focusout', saiu);
    const atual = campoDe(document.activeElement);
    if (atual && aberto) esconderTecladoDoSistema(atual);
    if (!aberto) devolverTecladoDoSistema(document.activeElement);
    return () => {
      document.removeEventListener('focusin', entrou);
      document.removeEventListener('focusout', saiu);
    };
  }, [aberto]);

  // Reserva o espaço do teclado: a tela e os diálogos (fixed inset-0) terminam em cima dele
  useLayoutEffect(() => {
    const raiz = document.documentElement;
    const el = caixa.current;
    if (!aberto || !el) {
      raiz.style.setProperty('--teclado', '0px');
      return;
    }
    const medir = () => raiz.style.setProperty('--teclado', `${el.offsetHeight}px`);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => {
      obs.disconnect();
      raiz.style.setProperty('--teclado', '0px');
    };
  }, [aberto]);

  if (!ligado) return null;

  // A tecla não pode levar o foco do campo: o mouse (mousedown) é barrado e a ação vai no pointerdown (toque rápido)
  const tecla = (rotulo: React.ReactNode, acao: () => void, classe = TECLA, titulo?: string) => (
    <button
      type="button"
      tabIndex={-1}
      title={titulo}
      className={classe}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        acao();
      }}
    >
      {rotulo}
    </button>
  );

  if (recolhido) {
    return (
      <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-[350]">
        {tecla(<><Keyboard size={18} /> <span className="text-xs">Teclado</span></>, () => setRecolhido(false), `${TECLA_FUNCAO} !h-9 px-3 gap-1.5 shadow-lg`, 'Mostrar o teclado virtual')}
      </div>
    );
  }

  const soNumeros = numerico(campo);
  const recolher = (classe: string) =>
    tecla(<><ChevronDown size={18} /> <span className="text-xs">Recolher</span></>, () => setRecolhido(true), `${TECLA_FUNCAO} gap-1 ${classe}`, 'Esconder o teclado virtual');
  return (
    <div ref={caixa} className="fixed inset-x-0 bottom-0 z-[350] bg-stone-200/95 backdrop-blur-xs border-t border-stone-300 p-1.5 select-none">
      <div className="flex gap-3 justify-center">
        {!soNumeros && (
          <div className="flex flex-col gap-1 flex-1 max-w-3xl">
            {LETRAS.map((linha, i) => (
              <div key={linha} className="flex gap-1">
                {i === 2 && tecla(maiusculas ? 'ABC' : 'abc', () => setMaiusculas(!maiusculas), `${TECLA_FUNCAO} flex-[1.5] ${maiusculas ? '!bg-blue-100 text-blue-700' : ''}`, 'Maiúsculas / minúsculas')}
                {[...linha].map((l) => {
                  const ch = maiusculas ? l.toUpperCase() : l;
                  return <React.Fragment key={l}>{tecla(ch, () => teclar(ch), `${TECLA} flex-1`)}</React.Fragment>;
                })}
              </div>
            ))}
            <div className="flex gap-1">
              {tecla('@', () => teclar('@'), `${TECLA} flex-1`)}
              {tecla('/', () => teclar('/'), `${TECLA} flex-1`)}
              {tecla('espaço', () => teclar(' '), `${TECLA_FUNCAO} flex-[6]`)}
              {tecla('*', () => teclar('*'), `${TECLA} flex-1`)}
              {tecla('+', () => teclar('+'), `${TECLA} flex-1`)}
              {recolher('flex-[1.5]')}
            </div>
          </div>
        )}
        <div className="grid grid-cols-4 gap-1 w-[18rem] shrink-0">
          {NUMEROS.map((n, i) => (
            <React.Fragment key={n}>
              {tecla(n, () => teclar(n))}
              {i === 2 && tecla(<Delete size={22} />, () => teclar('Backspace'), TECLA_FUNCAO, 'Apagar')}
              {i === 5 && tecla('Esc', () => teclar('Escape'), TECLA_FUNCAO, 'Sair / fechar')}
              {i === 8 && (
                <div className="grid grid-rows-2 gap-1">
                  {tecla(<ArrowUp size={16} />, () => teclar('ArrowUp'), `${TECLA_FUNCAO} !h-5`, 'Para cima')}
                  {tecla(<ArrowDown size={16} />, () => teclar('ArrowDown'), `${TECLA_FUNCAO} !h-5`, 'Para baixo')}
                </div>
              )}
              {i === 11 && tecla(<><CornerDownLeft size={20} /> <span className="text-sm">Enter</span></>, () => teclar('Enter'), `${TECLA} !bg-blue-600 !text-white !border-blue-600 active:!bg-blue-700 gap-1`, 'Confirmar / próximo campo')}
            </React.Fragment>
          ))}
        </div>
        {/* Só o numérico (sem a linha de letras): o Recolher vira uma coluna ao lado */}
        {soNumeros && recolher('!h-auto flex-col w-20 shrink-0')}
      </div>
    </div>
  );
}
