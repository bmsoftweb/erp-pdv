-- Imagens do PDV: a mesma tabela guarda as da tela do caixa (vitrine do operador, horizontal 3:2) e as da tela do
-- cliente (segundo monitor, coluna vertical 2:3). Cadastradas em abas separadas no BM-Master.
-- Rodar no bmerp_000000. Reversão no fim do arquivo.

ALTER TABLE pdv_imagens
  ADD COLUMN tela VARCHAR(10) NOT NULL DEFAULT 'caixa' COMMENT 'caixa = tela de venda do operador; cliente = tela do cliente (vertical)' AFTER empresa_id,
  DROP INDEX idx_pdv_imagens_empresa,
  ADD KEY idx_pdv_imagens_empresa (empresa_id, tela, ativo);

-- ===== Reversão =====
-- DELETE FROM pdv_imagens WHERE tela = 'cliente';
-- ALTER TABLE pdv_imagens DROP INDEX idx_pdv_imagens_empresa, DROP COLUMN tela, ADD KEY idx_pdv_imagens_empresa (empresa_id, ativo);
