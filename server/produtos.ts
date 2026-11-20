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
      const [rows] = await pool.execute(
        'SELECT id, nome, codigo_barras, preco_venda, iat FROM cad_produtos WHERE ativo = 1 AND grupo_id = ?',
        [grupoDa(res)]
      );
      res.json(rows);
    } catch (error) {
      console.error('Erro ao sincronizar produtos:', error);
      res.status(500).json({ error: 'Erro interno no servidor' });
    }
  });

  return r;
}
