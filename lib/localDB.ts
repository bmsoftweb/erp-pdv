import Dexie, { type Table } from 'dexie';

export interface LocalProduct {
  id: number;
  nome: string;
  codigo_barras: string;
  preco_venda: number | string;
  /** Arredondamento (A) ou truncamento (T) do total do item */
  iat?: string | null;
  categoria_id?: number | null;
  /** URL da foto principal (pesquisa por categoria, código 77) */
  foto?: string | null;
  /** Sigla da unidade (KG = pesado na balança do caixa) */
  unidade?: string | null;
  /** Clube de descontos: preço do associado e o último dia da promoção (lib/clube.ts) */
  preco_clube?: number | null;
  clube_ate?: string | null;
}

/** Produto vendido por peso: pede o peso à balança (ou digitado) */
export const porKg = (p: LocalProduct | null | undefined) => p?.unidade?.toUpperCase() === 'KG';

/** Base local do PDV no IndexedDB: cópia dos produtos do servidor (a venda só fecha online) */
class BaseLocal extends Dexie {
  products!: Table<LocalProduct, number>;

  constructor() {
    super('PdvLocal');
    // v2: sai a tabela config (guardava o atalho do .ini, que deixou de existir)
    this.version(2).stores({ products: 'id, codigo_barras, nome', config: null });
  }
}

export const db = new BaseLocal();

if (typeof window !== 'undefined') {
  // Sem isso o navegador pode apagar a base local quando faltar espaço (no PWA instalado o Chrome concede)
  navigator.storage?.persist?.().catch(() => {});
  // Base antiga (sql.js gravado inteiro num blob): os produtos voltam na sincronização ao abrir
  Dexie.delete('SQLiteLocalDB').catch(() => {});
}

/** Troca a lista inteira numa transação: ou fica a lista nova, ou a antiga */
export function substituirProdutos(lista: LocalProduct[]) {
  return db.transaction('rw', db.products, async () => {
    await db.products.clear();
    await db.products.bulkPut(lista.map((p) => ({ ...p, iat: p.iat ?? 'A' })));
  });
}

/** Parte da descrição (sem diferenciar maiúsculas), ou o código de barras / código interno exatos */
export function buscarProdutos(texto: string, limite: number) {
  const t = texto.toLowerCase();
  return db.products
    .orderBy('nome')
    .filter((p) => String(p.nome).toLowerCase().includes(t) || p.codigo_barras === texto || String(p.id) === texto)
    .limit(limite)
    .toArray();
}
