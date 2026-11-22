import { Router } from 'express';
import { pool } from './db.js';
import type { SessionData } from './session.js';

// Vitrine da tela de venda (pdv_imagens, extras/2026-11-20_pdv_imagens.sql), cadastrada no BM-Master
// (Configurações da empresa → Imagens do PDV): as ativas da filial que ainda não venceram, na ordem, com o período.
// As que começam mais tarde também vão: o PDV guarda tudo no cache do navegador e filtra pelo dia, então a imagem
// de uma data entra no dia certo mesmo sem internet. O pool roda em -03:00, então CURDATE() é o dia de Brasília.

const semTabela = (e: any) => e?.code === 'ER_NO_SUCH_TABLE';

export function createImagensRouter() {
  const r = Router();

  // ?tela=cliente: as da tela do cliente (vertical); sem ela, as do caixa
  r.get('/imagens', async (req, res) => {
    try {
      const s = res.locals.sessao as SessionData;
      const tela = req.query.tela === 'cliente' ? 'cliente' : 'caixa';
      const [linhas] = await pool.query(
        `SELECT id, titulo, DATE_FORMAT(COALESCE(atualizado_em, criado_em), '%Y%m%d%H%i%s') AS versao,
                DATE_FORMAT(data_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(data_fim, '%Y-%m-%d') AS fim
           FROM pdv_imagens
          WHERE empresa_id = ? AND tela = ? AND ativo = 1 AND (data_fim IS NULL OR data_fim >= CURDATE())
          ORDER BY ordem, id`,
        [s.empresaId, tela],
      );
      res.json(linhas);
    } catch (e: any) {
      if (semTabela(e) || e?.code === 'ER_BAD_FIELD_ERROR') return void res.json([]); // sem a tabela ou sem a coluna tela
      console.error('Imagens do PDV:', e);
      res.status(500).json({ error: 'Erro ao ler as imagens do PDV.' });
    }
  });

  // A URL leva a versão (?v=), então a imagem pode ficar no cache do navegador
  r.get('/imagens/:id', async (req, res) => {
    try {
      const s = res.locals.sessao as SessionData;
      const [[i]]: any = await pool.query('SELECT imagem, tipo FROM pdv_imagens WHERE id = ? AND empresa_id = ?', [Number(req.params.id), s.empresaId]);
      if (!i) return void res.status(404).json({ error: 'Imagem não encontrada.' });
      res.set('Cache-Control', 'private, max-age=604800').type(i.tipo).send(i.imagem);
    } catch (e: any) {
      console.error('Imagem do PDV:', e);
      res.status(500).json({ error: 'Erro ao ler a imagem.' });
    }
  });

  return r;
}
