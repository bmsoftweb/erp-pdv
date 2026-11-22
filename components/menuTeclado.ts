import React, { useEffect, useRef } from 'react';

/**
 * Menu suspenso pelo teclado (Menu Fiscal, "Mais"): ao abrir, o foco vai para o primeiro item;
 * setas ↑ ↓ escolhem, Enter executa, o número da opção (1, 2…) entra nela, Esc fecha e devolve o foco para onde estava.
 * As teclas tratadas aqui não chegam aos atalhos da tela de venda.
 */
export function useMenuTeclado(aberto: boolean, setAberto: (v: boolean) => void) {
  const lista = useRef<HTMLDivElement>(null);
  const focoAntes = useRef<HTMLElement | null>(null);
  const itens = () => [...(lista.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];

  useEffect(() => {
    if (!aberto) return;
    focoAntes.current = document.activeElement as HTMLElement | null;
    itens()[0]?.focus();
  }, [aberto]);

  const fechar = () => {
    setAberto(false);
    focoAntes.current?.focus();
  };

  const teclas = (e: React.KeyboardEvent) => {
    const botoes = itens();
    const i = botoes.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') botoes[(i + 1) % botoes.length]?.focus();
    else if (e.key === 'ArrowUp') botoes[(i - 1 + botoes.length) % botoes.length]?.focus();
    else if (e.key === 'Escape') fechar();
    else if (/^[1-9]$/.test(e.key)) {
      // Número da opção (teclado numérico): entra direto nela
      const item = lista.current?.querySelectorAll<HTMLButtonElement>('button')[Number(e.key) - 1];
      if (item && !item.disabled) item.click();
    }
    else if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.key !== 'Enter' && e.key !== ' ') e.preventDefault();
    e.stopPropagation();
  };

  return { lista, fechar, teclas };
}

/** Número da opção, à esquerda do item */
export const NUMERO_MENU = 'w-4 shrink-0 text-right font-mono font-bold text-stone-400';

/** Item de menu com o destaque do foco do teclado */
export const ITEM_MENU = 'w-full text-left flex items-start gap-3 px-3 py-2 hover:bg-stone-100 focus:bg-blue-50 focus:text-blue-700 outline-none transition-colors text-xs font-medium text-stone-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
