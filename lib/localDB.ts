import Dexie, { type Table } from 'dexie';

export interface LocalProduct {
  id: number;
  nome: string;
  codigo_barras: string;
  preco_venda: number | string;
  /** Arredondamento (A) ou truncamento (T) do total do item */
  iat?: string | null;
}

/**
 * Base local do PDV no IndexedDB: cópia dos produtos do servidor (a venda só fecha online)
 * e os atalhos de arquivo (.ini) escolhidos pelo operador.
 */
class BaseLocal extends Dexie {
  products!: Table<LocalProduct, number>;
  config!: Table<unknown, string>;

  constructor() {
    super('PdvLocal');
    this.version(1).stores({ products: 'id, codigo_barras, nome', config: '' });
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

// ----- Arquivo .ini (File System Access) -----

export async function getSavedIniFileName(): Promise<string | null> {
  return ((await db.config.get('ini_file_name').catch(() => null)) as string) || null;
}

export async function getSavedIniHandle(): Promise<any | null> {
  return (await db.config.get('ini_file_handle').catch(() => null)) || null;
}

export async function saveIniHandle(handle: any): Promise<void> {
  await db.config.bulkPut([handle, handle.name], ['ini_file_handle', 'ini_file_name']).catch(() => {});
}

export async function disconnectIniFile(): Promise<void> {
  await db.config.bulkDelete(['ini_file_handle', 'ini_file_name']).catch(() => {});
}

export async function readIniFileContent(handle: any): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

export function parseINI(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection = 'default';

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1).trim();
      continue;
    }

    const parts = trimmed.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      if (!result[currentSection]) result[currentSection] = {};
      result[currentSection][key] = value;
    }
  }
  return result;
}
