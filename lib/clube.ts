/**
 * Clube de descontos (script extras/2026-11-22_clube_descontos.sql): o associado (cad_pessoas.clube_desconto) paga o
 * preço das listas de preço do clube em vigor (erp-estoque, critério "Clube de descontos"). A sincronização traz em
 * cada produto o preço do clube e o último dia da lista (server/clube.ts).
 */

/** Preço do item na venda: o do clube para o associado, enquanto a lista vale (hoje = AAAA-MM-DD) */
export function precoNaVenda(
  p: { preco_venda: number | string; preco_clube?: number | null; clube_ate?: string | null },
  associado: boolean,
  hoje: string,
): number {
  const normal = Number(p.preco_venda);
  return associado && p.preco_clube != null && p.clube_ate && hoje <= p.clube_ate ? Number(p.preco_clube) : normal;
}
