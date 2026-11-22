import { Router } from 'express';
import { pool } from './db.js';
import { grupoDa } from './auth.js';

export function createProdutosRouter() {
  const r = Router();

  r.get('/produto', async (req, res) => {
    const ean = req.query.ean as string | undefined;
    if (!ean) return void res.status(400).json({ error: 'EAN é obrigatório' });

    try {
      const [rows] = await pool.execute(
        'SELECT id, nome, codigo_barras, preco_venda FROM cad_produtos WHERE (codigo_barras = ? OR id = ?) AND grupo_id = ? LIMIT 1',
        [ean, ean, grupoDa(res)]
      );
      const produtos = rows as any[];
      if (produtos.length === 0) return void res.status(404).json({ error: 'Produto não encontrado' });
      res.json(produtos[0]);
    } catch (error) {
      console.error('Erro ao buscar produto:', error);
      res.status(500).json({ error: 'Erro interno no servidor' });
    }
  });

  r.get('/produtos/sync', async (_req, res) => {
    try {
      // categoria e foto (a principal, senão a primeira) servem à pesquisa por categoria (código 77);
      // a unidade (KG) diz que o produto é pesado na balança do caixa
      const [rows] = await pool.execute(
        `SELECT p.id, p.nome, p.codigo_barras, p.preco_venda, p.iat, p.categoria_id, u.sigla AS unidade,
                (SELECT i.url FROM cad_produtos_imagens i WHERE i.produto_id = p.id AND i.variante_id IS NULL
                  ORDER BY i.principal DESC, i.ordem, i.id LIMIT 1) AS foto
           FROM cad_produtos p LEFT JOIN cad_produtos_unidades_medida u ON u.id = p.unidade_id
          WHERE p.ativo = 1 AND p.grupo_id = ?`,
        [grupoDa(res)]
      );
      res.json(rows);
    } catch (error) {
      console.error('Erro ao sincronizar produtos:', error);
      res.status(500).json({ error: 'Erro interno no servidor' });
    }
  });

  // Pesquisa por categoria (código 77): as categorias marcadas (pdv_pesquisa, SQL 2026-11-21_categorias_pdv_pesquisa.sql)
  // com os ids dela e das subcategorias, para o PDV filtrar os produtos da base local
  r.get('/produtos/categorias', async (_req, res) => {
    try {
      const [linhas]: any = await pool.execute(
        'SELECT id, nome, categoria_pai, pdv_pesquisa FROM cad_produtos_categorias WHERE ativo = 1 AND grupo_id = ? ORDER BY nome',
        [grupoDa(res)]
      );
      const filhos = (id: number): number[] =>
        linhas.filter((c: any) => Number(c.categoria_pai) === id).flatMap((c: any) => [c.id, ...filhos(c.id)]);
      res.json(linhas.filter((c: any) => Number(c.pdv_pesquisa) === 1).map((c: any) => ({ id: c.id, nome: c.nome, ids: [c.id, ...filhos(c.id)] })));
    } catch (error: any) {
      if (error?.code === 'ER_BAD_FIELD_ERROR') return void res.json([]); // SQL do campo pdv_pesquisa ainda não rodou
      console.error('Categorias da pesquisa:', error);
      res.status(500).json({ error: 'Erro ao ler as categorias.' });
    }
  });

  return r;
}
