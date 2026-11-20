import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/** Diálogo das telas novas do PDV: fundo escuro, cartão branco, fecha no X ou no Esc */
export function Janela({ titulo, onFechar, children, largura = 'max-w-lg', rodape }: {
  titulo: React.ReactNode;
  onFechar: () => void;
  children: React.ReactNode;
  largura?: string;
  rodape?: React.ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onFechar();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onFechar]);

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm" onKeyDown={(e) => e.stopPropagation()}>
      <div className={`campos-padrao bg-white rounded-2xl shadow-2xl w-full ${largura} max-h-[90vh] flex flex-col`}>
        <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">{titulo}</h3>
          <button type="button" onClick={onFechar} title="Fechar (Esc)" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 min-h-0">{children}</div>
        {rodape && <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">{rodape}</div>}
      </div>
    </div>
  );
}

export const BOTAO = 'h-[38px] px-4 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const BOTAO_PRIMARIO = `${BOTAO} bg-blue-600 text-white hover:bg-blue-700`;
export const BOTAO_SECUNDARIO = `${BOTAO} bg-white border border-gray-200 text-gray-700 hover:bg-gray-50`;
