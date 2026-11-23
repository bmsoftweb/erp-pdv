/**
 * Regras fiscais do PDV usadas no navegador e no servidor (PAF-NFC-e de SC, Ato DIAT 54/2026).
 */
/** Identificação do PAF-NFC-e: vai no obsFisco "PAF" e no verProc de todo DF-e (Requisito IV, § 4º); a versão é a da sys_paf (versaoPaf) */
export const PAF = {
  nome: 'BM-PDV',
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

/**
 * GTIN que pode ir no cEAN/cEANTrib da nota; null = "SEM GTIN" (o erp-nfe preenche). A SEFAZ confere o GTIN no
 * Cadastro Centralizado de GTIN e rejeita a nota quando não confere (RICMS/SC, Anexo 11, arts. 96, VIII, e 99, § 1º):
 * código interno da loja (etiqueta de balança, produto sem código de fábrica) vai só no cProd.
 * Fica de fora: tamanho fora de 8/12/13/14, dígito verificador errado e os prefixos GS1 de circulação restrita
 * (uso interno): 020–029, 040–049 e 200–299 no GTIN-13 (o GTIN-12 conta com um zero na frente, o GTIN-14 sem o
 * indicador) e GTIN-8 começado por 0 ou 2.
 */
export function gtinPublico(codigo: unknown): string | null {
  const g = digitos(codigo);
  if (![8, 12, 13, 14].includes(g.length)) return null;
  const soma = [...g.slice(0, -1)].reverse().reduce((t, d, i) => t + Number(d) * (i % 2 ? 1 : 3), 0);
  if ((10 - (soma % 10)) % 10 !== Number(g.at(-1))) return null;
  if (g.length === 8) return /^[02]/.test(g) ? null : g;
  const prefixo = Number((g.length === 14 ? g.slice(1) : g.padStart(13, '0')).slice(0, 3));
  const restrito = (prefixo >= 20 && prefixo <= 29) || (prefixo >= 40 && prefixo <= 49) || (prefixo >= 200 && prefixo <= 299);
  return restrito ? null : g;
}

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
 * Fim do prazo de cancelamento da NFC-e (ms desde 1970): 30 min da Autorização de Uso, o dhRecbto do protocolo
 * (RICMS/SC Anexo 11, art. 106). Depois, só NF-e de estorno (parágrafo único). null = sem prazo aqui (NF-e: a SEFAZ decide).
 */
export function limiteCancelamento(modelo: string, autorizacao: string | null | undefined): number | null {
  const t = modelo === '65' && autorizacao ? Date.parse(autorizacao) : NaN;
  return Number.isNaN(t) ? null : t + 30 * 60_000;
}

export const ESTORNO_NFCE =
  'Passou o prazo de 30 minutos da autorização: a NFC-e não pode mais ser cancelada. Se a venda não aconteceu, corrija com NF-e de estorno ' +
  '(finalidade ajuste, natureza "Estorno de NF-e não cancelada no prazo legal", chave desta NFC-e, mesmos itens e valores, CFOP de devolução ' +
  'e a justificativa nas informações ao fisco), conforme o art. 106, parágrafo único, do Anexo 11 do RICMS/SC.';

/** NFC-e vedada a partir deste total: sai NF-e (RICMS/SC Anexo 11, art. 96, § 7º) */
export const LIMITE_NFCE = 200000;

/**
 * Modelo do DF-e pelo adquirente (Requisito IV, II), sem escolha do operador:
 * CNPJ, ou CPF com inscrição estadual de produtor primário, ou total ≥ R$ 200.000,00 → NF-e 55; o resto → NFC-e 65.
 */
export function modeloDoDocumento(documento: unknown, ieProdutor?: unknown, total = 0): '55' | '65' {
  const d = digitos(documento);
  if (d.length === 14 || total >= LIMITE_NFCE) return '55';
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
