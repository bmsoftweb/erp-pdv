import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Campos que o Enter percorre (na ordem da tela) */
const CAMPOS = 'input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';

const campos = (caixa: HTMLElement) =>
  [...caixa.querySelectorAll<HTMLElement>(CAMPOS)].filter((c) => c.tabIndex >= 0 && c.offsetParent !== null);

const listaAberta = (el: Element) => {
  try {
    return el.matches(':open');
  } catch {
    return false; // navegador sem :open
  }
};

/**
 * Navegação só com Enter, Esc e números (tela touch / teclado numérico): Enter num campo passa para o
 * próximo; no último, confirma (envia o formulário do campo ou aperta o botão principal, o último do
 * rodapé). Textarea fica com o Enter (quebra de linha). Quem já tratou o Enter (preventDefault) manda.
 */
export function avancarComEnter(e: React.KeyboardEvent, caixa: HTMLElement | null, confirmar: () => void) {
  if (e.key !== 'Enter' || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || !caixa) return;
  const el = e.target as HTMLElement;
  if (!/^(INPUT|SELECT)$/.test(el.tagName) || listaAberta(el)) return;
  e.preventDefault();
  const lista = campos(caixa);
  const proximo = lista[lista.indexOf(el) + 1];
  if (proximo) {
    proximo.focus();
    if (proximo instanceof HTMLInputElement) proximo.select();
    return;
  }
  const form = (el as HTMLInputElement).form;
  if (form) form.requestSubmit();
  else confirmar();
}

/**
 * Diálogo do PDV no visual dos outros módulos (ConfirmDialog do erp-vendas): fecha no X ou no Esc.
 * Abre com o foco no primeiro campo (ou no botão principal, sem campos) e o Enter avança até confirmar.
 */
export function Janela({ titulo, onFechar, children, largura = 'max-w-lg', rodape }: {
  titulo: React.ReactNode;
  onFechar: () => void;
  children: React.ReactNode;
  largura?: string;
  rodape?: React.ReactNode;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const rodapeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onFechar();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onFechar]);

  /** Botão principal: o último do rodapé, quando há mais de um (só "Fechar" não confirma nada) */
  const principal = () => {
    const botoes = [...(rodapeRef.current?.querySelectorAll('button') ?? [])];
    return botoes.length > 1 ? botoes[botoes.length - 1] : undefined;
  };

  // Ao abrir: foco no primeiro campo, se o conteúdo ainda não pôs o foco em algum lugar (autoFocus)
  useEffect(() => {
    const c = caixa.current;
    if (!c || c.contains(document.activeElement)) return;
    const primeiro = campos(c)[0];
    if (primeiro) {
      primeiro.focus();
      if (primeiro instanceof HTMLInputElement) primeiro.select();
    } else {
      const b = principal();
      if (b && !b.disabled) b.focus();
    }
  }, []);

  return (
    <div className="fixed inset-0 bg-stone-950/70 z-[200] flex items-center justify-center p-4 backdrop-blur-xs" onKeyDown={(e) => e.stopPropagation()}>
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => avancarComEnter(e, caixa.current, () => {
          const b = principal();
          if (b && !b.disabled) b.click();
        })}
        className={`bg-white border border-stone-200 rounded-2xl shadow-2xl w-full ${largura} max-h-[90vh] flex flex-col`}
      >
        <div className="flex justify-between items-center px-5 py-4 border-b border-stone-200 shrink-0">
          <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">{titulo}</h3>
          <button type="button" onClick={onFechar} title="Fechar (Esc)" className="p-1 rounded text-stone-400 hover:text-stone-700 cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 min-h-0">{children}</div>
        {rodape && <div ref={rodapeRef} className="px-5 py-3 border-t border-stone-200 bg-stone-50 rounded-b-2xl flex justify-end gap-2.5 shrink-0">{rodape}</div>}
      </div>
    </div>
  );
}

export const BOTAO = 'flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const BOTAO_PRIMARIO = `${BOTAO} bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-xs`;
export const BOTAO_SECUNDARIO = `${BOTAO} border border-stone-300 text-stone-600 hover:bg-stone-100`;
