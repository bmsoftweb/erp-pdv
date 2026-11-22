-- Pesquisa por categoria do PDV (código 77): categorias de produtos pesados no caixa ou sem código de barras
-- (hortifrúti, padaria…). As marcadas aparecem na 1ª aba da tela; os produtos dela e das subcategorias, na 2ª.
-- Marcadas no cadastro de categorias do erp-estoque. Rodar no bmerp_000000. Reversão no fim do arquivo.

ALTER TABLE cad_produtos_categorias
  ADD COLUMN pdv_pesquisa TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = aparece na pesquisa por categoria do PDV (código 77)' AFTER categoria_pai;

-- ===== Reversão =====
-- ALTER TABLE cad_produtos_categorias DROP COLUMN pdv_pesquisa;
