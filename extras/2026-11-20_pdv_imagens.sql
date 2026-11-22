-- Vitrine do PDV: imagens de promoção e datas comemorativas que se revezam na tela de venda (painel esquerdo,
-- abaixo do último item). Cadastradas no BM-Master (Configurações da empresa → Imagens do PDV); o erp-pdv mostra as
-- ativas dentro do período (data_inicio/data_fim vazias = sem limite), na ordem.
-- Rodar no bmerp_000000. Reversão no fim do arquivo.

CREATE TABLE pdv_imagens (
  id INT NOT NULL AUTO_INCREMENT,
  empresa_id INT NOT NULL COMMENT 'sys_empresas.id',
  titulo VARCHAR(100) NULL COMMENT 'Texto sobre a imagem (ex.: Parabéns Mamãe!!); vazio = só a imagem',
  imagem MEDIUMBLOB NOT NULL COMMENT 'Imagem já reduzida pelo Master (WebP até 1200 px)',
  tipo VARCHAR(30) NOT NULL COMMENT 'Content-Type da imagem (image/webp, image/jpeg, image/png)',
  data_inicio DATE NULL COMMENT 'Primeiro dia em que aparece; vazio = desde já',
  data_fim DATE NULL COMMENT 'Último dia em que aparece; vazio = sem fim',
  ordem INT NOT NULL DEFAULT 0,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL,
  atualizado_em DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_pdv_imagens_empresa (empresa_id, ativo)
);

-- ===== Reversão =====
-- DROP TABLE pdv_imagens;
