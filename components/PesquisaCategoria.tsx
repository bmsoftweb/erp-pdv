import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ImageOff, LayoutGrid, X } from 'lucide-react';
import { db, type LocalProduct } from '@/lib/localDB';

/** Categoria marcada para a pesquisa (pdv_pesquisa) com os ids dela e das subcategorias */
interface Categoria {
  id: number;
  nome: string;
  ids: number[];
}

const CHAVE = 'pdv.categoriasPesquisa';
const brl = (v: number | string) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Última lista do servidor fica no navegador: sem conexão a pesquisa continua com ela */
async function carregarCategorias(): Promise<Categoria[]> {
  try {
    const r = await fetch('/api/produtos/categorias');
    if (!r.ok) throw new Error();
    const lista: Categoria[] = await r.json();
    try {
      localStorage.setItem(CHAVE, JSON.stringify(lista));
    } catch {
      /* armazenamento bloqueado */
    }
    return lista;
  } catch {
    try {
      return JSON.parse(localStorage.getItem(CHAVE) || '[]');
    } catch {
      return [];
    }
  }
}

/** Foto do bloco; sem foto (ou se não carregar, ex.: sem internet), o ícone de fundo fica à vista */
const Foto: React.FC<{ src?: string | null }> = ({ src }) => (
  <div className="relative w-full aspect-[4/3] bg-stone-100 rounded-md overflow-hidden flex items-center justify-center">
    <ImageOff size={36} className="text-stone-300" />
    {src && <img src={src} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />}
  </div>
);

/**
 * Pesquisa por categoria (código 77): produtos pesados no caixa ou sem código de barras (hortifrúti, padaria…).
 * 1ª aba: as categorias marcadas no cadastro (pdv_pesquisa); 2ª aba: os produtos dela, com foto. Escolhido o produto,
 * a tela de venda pede a quantidade (ou o valor total), como no F3.
 * Teclado: setas andam nos blocos, Enter escolhe, 1 a 9 escolhem direto, Esc volta às categorias / fecha.
 */
export function PesquisaCategoria({ onFechar, onEscolher }: { onFechar: () => void; onEscolher: (p: LocalProduct) => void }) {
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [produtos, setProdutos] = useState<LocalProduct[]>([]);
  const [categoria, setCategoria] = useState<Categoria | null>(null);
  const [sel, setSel] = useState(0);
  const grade = useRef<HTMLDivElement>(null);

  useEffect(() => {
    carregarCategorias().then(setCategorias);
    db.products
      .orderBy('nome')
      .toArray()
      .then(setProdutos)
      .catch(() => setProdutos([]));
  }, []);

  const daCategoria = useMemo(() => {
    const m = new Map<number, LocalProduct[]>();
    for (const c of categorias ?? []) m.set(c.id, produtos.filter((p) => p.categoria_id != null && c.ids.includes(Number(p.categoria_id))));
    return m;
  }, [categorias, produtos]);

  const itens: (Categoria | LocalProduct)[] = categoria ? (daCategoria.get(categoria.id) ?? []) : (categorias ?? []);

  const escolher = (i: number) => {
    const item = itens[i];
    if (!item) return;
    if (categoria) return onEscolher(item as LocalProduct);
    setCategoria(item as Categoria);
    setSel(0);
  };

  const voltar = () => {
    if (!categoria) return onFechar();
    setSel(Math.max(0, (categorias ?? []).findIndex((c) => c.id === categoria.id)));
    setCategoria(null);
  };

  // O bloco escolhido fica com o foco (e à vista): Enter/espaço do teclado virtual também chegam nele
  useEffect(() => {
    const b = grade.current?.querySelectorAll<HTMLButtonElement>('[data-bloco]')[sel];
    b?.focus({ preventScroll: true });
    b?.scrollIntoView({ block: 'nearest' });
  }, [sel, categoria, itens.length]);

  const teclas = (e: React.KeyboardEvent) => {
    const colunas = grade.current ? getComputedStyle(grade.current).gridTemplateColumns.split(' ').length : 1;
    const mover: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: colunas, ArrowUp: -colunas };
    if (e.key in mover) {
      const n = sel + mover[e.key];
      if (n >= 0 && n < itens.length) setSel(n);
    } else if (e.key === 'Enter' || e.key === ' ') escolher(sel);
    else if (e.key === 'Escape' || e.key === 'Backspace') voltar();
    else if (/^[1-9]$/.test(e.key)) escolher(Number(e.key) - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="fixed inset-0 z-[150] bg-stone-900/60 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div role="dialog" aria-label="Pesquisa por categoria" onKeyDown={teclas} className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90%] flex flex-col overflow-hidden">
        <header className="flex items-center gap-2 px-5 pt-4 border-b border-stone-200 shrink-0">
          <LayoutGrid size={20} className="text-blue-600 mb-3" />
          <h2 className="text-lg font-bold text-stone-900 mb-3 mr-4">Pesquisa por categoria</h2>
          {/* Abas: 1 Categorias → 2 Produtos */}
          <button type="button" onClick={() => categoria && voltar()} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px cursor-pointer ${categoria ? 'border-transparent text-stone-500 hover:text-stone-800' : 'border-blue-600 text-blue-700'}`}>
            1. Categorias
          </button>
          <button type="button" disabled={!categoria} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${categoria ? 'border-blue-600 text-blue-700' : 'border-transparent text-stone-300'}`}>
            2. Produtos{categoria ? `: ${categoria.nome}` : ''}
          </button>
          <button type="button" onClick={onFechar} title="Fechar (Esc)" className="ml-auto mb-3 p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 bg-stone-50">
          {categorias === null ? (
            <p className="text-center text-stone-400 py-16">Carregando…</p>
          ) : !itens.length ? (
            <p className="text-center text-stone-500 py-16">
              {categoria ? 'Nenhum produto nesta categoria.' : 'Nenhuma categoria marcada para a pesquisa no PDV (cadastro de categorias do Estoque).'}
            </p>
          ) : (
            <div ref={grade} className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
              {itens.map((item, i) => {
                const p = categoria ? (item as LocalProduct) : null;
                const lista = p ? [] : (daCategoria.get(item.id) ?? []);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-bloco
                    onClick={() => (setSel(i), escolher(i))}
                    className={`relative text-left bg-white rounded-lg border p-2 flex flex-col gap-2 cursor-pointer outline-none transition-shadow ${
                      i === sel ? 'border-blue-500 ring-2 ring-blue-500 shadow-md' : 'border-stone-200 hover:border-blue-300'
                    }`}
                  >
                    {i < 9 && <span className="absolute top-3 left-3 z-10 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shadow">{i + 1}</span>}
                    <Foto src={p ? p.foto : lista.find((x) => x.foto)?.foto} />
                    <span className="font-bold text-stone-900 uppercase leading-tight line-clamp-2 min-h-[2.5em]">{item.nome}</span>
                    {p ? (
                      <span className="text-xl font-black text-blue-700">{brl(p.preco_venda)}</span>
                    ) : (
                      <span className="text-sm text-stone-500">
                        {lista.length} {lista.length === 1 ? 'produto' : 'produtos'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="px-5 py-2.5 border-t border-stone-200 text-xs text-stone-500 shrink-0 flex items-center gap-4">
          {categoria && (
            <button type="button" onClick={voltar} className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline cursor-pointer">
              <ArrowLeft size={14} /> Voltar às categorias
            </button>
          )}
          <span className="ml-auto">Setas: andar · Enter ou 1 a 9: escolher · Esc: {categoria ? 'voltar' : 'fechar'}</span>
        </footer>
      </div>
    </div>
  );
}
