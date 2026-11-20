-- PAF-NFC-e (SC, Ato DIAT 54/2026): campos e tabelas que o erp-pdv passa a usar.
-- Rodar no bmerp_000000. Reversão no fim do arquivo.

-- Requisito VII: indicador de arredondamento/truncamento (A/T) e de produção própria/terceiros (P/T)
ALTER TABLE cad_produtos
  ADD COLUMN iat CHAR(1) NOT NULL DEFAULT 'A' COMMENT 'IAT: A = arredonda, T = trunca',
  ADD COLUMN ippt CHAR(1) NOT NULL DEFAULT 'T' COMMENT 'IPPT: P = produção própria, T = terceiros';

-- Requisito XI, § 2º: tabela de intermediadores (pagamento e transação), código sequencial de 3 dígitos por empresa
CREATE TABLE cad_intermediadores (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id BIGINT UNSIGNED NOT NULL,
  codigo CHAR(3) NOT NULL,
  tipo CHAR(1) NOT NULL COMMENT 'P = intermediador do pagamento, T = intermediador da transação',
  nome_fantasia VARCHAR(60) NOT NULL,
  cnpj CHAR(14) NOT NULL DEFAULT '',
  identificacao VARCHAR(60) NOT NULL DEFAULT '' COMMENT 'Identificação do estabelecimento no intermediador (idCadIntTran)',
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL,
  atualizado_em DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cad_intermediadores_codigo (empresa_id, codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Pagamentos de cada cupom (meio × intermediador): base do registro A2 do Arquivo I e do EConf
CREATE TABLE mov_nfce_pagamentos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  mov_nfce_id_app VARCHAR(25) NOT NULL,
  empresa_id BIGINT UNSIGNED NOT NULL,
  data DATE NOT NULL,
  modelo CHAR(2) NOT NULL,
  tpag CHAR(2) NOT NULL,
  valor DECIMAL(15,2) NOT NULL,
  intermediador_id INT UNSIGNED NOT NULL,
  cnpj_pag CHAR(14) NULL,
  uf_pag CHAR(2) NULL,
  bandeira CHAR(2) NULL,
  autorizacao VARCHAR(128) NULL,
  criado_em DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_mov_nfce_pagamentos_venda (mov_nfce_id_app),
  KEY ix_mov_nfce_pagamentos_data (empresa_id, data)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Intermediador padrão para o pagamento recebido na própria loja (dinheiro, cheque…): use o CNPJ da empresa.
-- Ajuste empresa_id e CNPJ antes de rodar (uma linha por empresa que usa o PDV).
-- INSERT INTO cad_intermediadores (empresa_id, codigo, tipo, nome_fantasia, cnpj, identificacao, criado_em)
-- VALUES (1, '001', 'P', 'PROPRIO ESTABELECIMENTO', '08511951000137', '', NOW());

-- ===== Reversão =====
-- DROP TABLE mov_nfce_pagamentos;
-- DROP TABLE cad_intermediadores;
-- ALTER TABLE cad_produtos DROP COLUMN ippt, DROP COLUMN iat;
