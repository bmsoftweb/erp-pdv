/**
 * Regras fiscais do PDV usadas no navegador e no servidor (PAF-NFC-e de SC, Ato DIAT 54/2026).
 */
import pacote from '../package.json' with { type: 'json' };

/** Identificação do PAF-NFC-e: vai no obsFisco "PAF" e no verProc de todo DF-e (Requisito IV, § 4º) */
export const PAF = {
  nome: 'BM-PDV',
  versao: pacote.version,
  /** Data da última atualização instalada (Requisito VI, I, b, 3): a do build */
  atualizadoEm: typeof __BUILD_DATA__ !== 'undefined' ? __BUILD_DATA__ : '',
};
declare const __BUILD_DATA__: string;

/**
 * Meios de pagamento da tabela do Portal Nacional da NF-e (tPag, Requisito XI, § 1º).
 * Os que pedem o grupo de cartão (card) levam o CNPJ do intermediador de pagamento.
 */
export const MEIOS_PAGAMENTO: { codigo: string; nome: string; cartao?: boolean }[] = [
  { codigo: '01', nome: 'Dinheiro' },
  { codigo: '02', nome: 'Cheque' },
  { codigo: '03', nome: 'Cartão de Crédito', cartao: true },
  { codigo: '04', nome: 'Cartão de Débito', cartao: true },
  { codigo: '05', nome: 'Cartão da Loja (Private Label)', cartao: true },
  { codigo: '10', nome: 'Vale Alimentação', cartao: true },
  { codigo: '11', nome: 'Vale Refeição', cartao: true },
  { codigo: '12', nome: 'Vale Presente', cartao: true },
  { codigo: '13', nome: 'Vale Combustível', cartao: true },
  { codigo: '15', nome: 'Boleto Bancário' },
  { codigo: '16', nome: 'Depósito Bancário' },
  { codigo: '17', nome: 'PIX Dinâmico', cartao: true },
  { codigo: '18', nome: 'Transferência Bancária / Carteira Digital', cartao: true },
  { codigo: '19', nome: 'Programa de Fidelidade / Cashback', cartao: true },
  { codigo: '20', nome: 'PIX Estático' },
  { codigo: '21', nome: 'Crédito em Loja' },
  { codigo: '22', nome: 'Pagamento Eletrônico não Informado' },
  { codigo: '99', nome: 'Outros' },
];

export const nomeMeioPagamento = (codigo: string) =>
  MEIOS_PAGAMENTO.find((m) => m.codigo === codigo)?.nome ?? `Meio ${codigo}`;

export const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export function cpfValido(valor: unknown): boolean {
  const c = digitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function cnpjValido(valor: unknown): boolean {
  const c = digitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((t, p, i) => t + Number(c[i]) * p, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

/**
 * Modelo do DF-e pelo adquirente (Requisito IV, II), sem escolha do operador:
 * CNPJ, ou CPF com inscrição estadual de produtor primário → NF-e 55; o resto → NFC-e 65.
 */
export function modeloDoDocumento(documento: unknown, ieProdutor?: unknown): '55' | '65' {
  const d = digitos(documento);
  if (d.length === 14) return '55';
  if (d.length === 11 && digitos(ieProdutor)) return '55';
  return '65';
}

/** Total do item pelo IAT do produto (Requisito VII, VIII): A = arredonda, T = trunca, em centavos */
export function totalDoItem(quantidade: number, valorUnitario: number, iat: string | null | undefined = 'A'): number {
  const bruto = quantidade * valorUnitario * 100;
  const centavos = String(iat).toUpperCase() === 'T' ? Math.floor(bruto + 1e-6) : Math.round(bruto + Number.EPSILON);
  return centavos / 100;
}

export const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Divide um valor pelos pesos, em centavos; a sobra vai no último (como o ratear do erp-vendas) */
export function ratear(total: number, pesos: number[]): number[] {
  const cent = Math.round(total * 100);
  const soma = pesos.reduce((s, p) => s + p, 0);
  if (!cent || !soma) return pesos.map(() => 0);
  const partes = pesos.map((p) => Math.trunc((cent * p) / soma));
  partes[partes.length - 1] += cent - partes.reduce((s, p) => s + p, 0);
  return partes.map((p) => p / 100);
}
