import { pool } from './db.js';
import { resolverPreco, type CampoCriterio, type ListaPreco } from '../lib/precos.js';

const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));
const data = (v: any): string | null => (!v ? null : v instanceof Date ? v.toLocaleDateString('sv-SE') : String(v).slice(0, 10));

/** Listas de preço do clube (critério clube) ativas e em vigor hoje; sem o SQL do clube, nenhuma */
export async function listasDoClube(grupo: number, hoje: string): Promise<ListaPreco[]> {
  try {
    const [ls]: any = await pool.query(
      `SELECT * FROM pre_listas
        WHERE ativo = 1 AND grupo_id = ? AND (vigencia_inicio IS NULL OR vigencia_inicio <= ?) AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
          AND id IN (SELECT lista_id FROM pre_lista_criterios WHERE campo = 'clube')`,
      [grupo, hoje, hoje],
    );
    if (!ls.length) return [];
    const ids = ls.map((l: any) => l.id);
    const [cs]: any = await pool.query('SELECT lista_id, campo, valor FROM pre_lista_criterios WHERE lista_id IN (?)', [ids]);
    const [is]: any = await pool.query('SELECT lista_id, escopo, escopo_id, tipo, valor FROM pre_lista_itens WHERE lista_id IN (?)', [ids]);
    return ls.map((l: any): ListaPreco => {
      const criterios: ListaPreco['criterios'] = {};
      for (const c of cs.filter((x: any) => x.lista_id === l.id)) (criterios[c.campo as CampoCriterio] ??= []).push(String(c.valor));
      return {
        id: l.id, nome: l.nome, prioridade: Number(l.prioridade) || 0, ativo: true,
        vigenciaInicio: data(l.vigencia_inicio), vigenciaFim: data(l.vigencia_fim),
        qtdMin: num(l.qtd_min), qtdMax: num(l.qtd_max), valorPedidoMin: num(l.valor_pedido_min), valorPedidoMax: num(l.valor_pedido_max),
        prazoMin: num(l.prazo_min), prazoMax: num(l.prazo_max), ajustePercentual: num(l.ajuste_percentual),
        criterios,
        itens: is.filter((i: any) => i.lista_id === l.id).map((i: any) => ({ escopo: i.escopo, escopoId: Number(i.escopo_id), tipo: i.tipo, valor: Number(i.valor) })),
      };
    });
  } catch (e: any) {
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD'].includes(e?.code)) return [];
    throw e;
  }
}

/**
 * Preço do associado para o produto pelas listas do clube (contexto: hoje, 1 unidade, associado) e o último dia
 * da lista que valeu. null = sem desconto. Lista com outros critérios (cidade, vendedor, faixa de quantidade…) não
 * vale no PDV, porque o caixa não manda esses dados.
 */
export function precoDoClube(
  listas: ListaPreco[],
  hoje: string,
  p: { id: number; preco_venda: number | string; categoria_id?: number | null; marca_id?: number | null },
): { preco: number; ate: string } | null {
  const r = resolverPreco(listas, { data: hoje, quantidade: 1, clube: '1' }, {
    id: Number(p.id), categoriaId: p.categoria_id ?? null, marcaId: p.marca_id ?? null, precoBase: Number(p.preco_venda),
  });
  if (r.origem !== 'lista' || !(r.preco > 0) || r.preco >= r.base) return null;
  return { preco: r.preco, ate: listas.find((l) => l.id === r.lista?.id)?.vigenciaFim ?? '9999-12-31' };
}
