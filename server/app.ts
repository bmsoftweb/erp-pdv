import express from 'express';
import { createAuthRouter, exigirSessao } from './auth.js';
import { createProdutosRouter } from './produtos.js';
import { createNotasRouter } from './notas.js';
import { createMenuFiscalRouter } from './menuFiscal.js';
import { createCaixaLocalRouter, createCaixaSitefRouter } from './caixas.js';
import { createImagensRouter } from './imagens.js';
import { createPixRouter } from './pix.js';

/**
 * App Express só com a API (/api/*). Usado pelo servidor local (server.ts), que põe o front-end por cima,
 * e pela função da Vercel (api/index.ts).
 */
export function createApp() {
  const app = express();
  // Limite folgado para a venda e o XML do Menu Fiscal (a Vercel corta em 4,5 MB)
  app.use(express.json({ limit: '20mb' }));

  app.use('/api', createAuthRouter());
  app.use('/api', createCaixaLocalRouter());
  app.use('/api', exigirSessao);
  app.use('/api', createProdutosRouter());
  app.use('/api', createCaixaSitefRouter());
  app.use('/api', createImagensRouter());
  app.use('/api', createNotasRouter());
  app.use('/api', createPixRouter());
  app.use('/api', createMenuFiscalRouter());

  // API desconhecida: 404 em JSON em vez de cair no index.html
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
  return app;
}
