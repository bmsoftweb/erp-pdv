-- PAF-NFC-e (SC, Ato DIAT 54/2026): dados da empresa desenvolvedora e arquitetura, numa linha só para todo o ERP.
-- Substitui as variáveis PAF_DESENVOLVEDOR_* e PAF_ARQ_* do .env do erp-pdv.
-- Rodar no bmerp_000000. Reversão no fim do arquivo.

CREATE TABLE sys_paf (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  desenvolvedor_razao VARCHAR(50) NOT NULL COMMENT 'Registro U2 do Arquivo I (50 posições)',
  desenvolvedor_cnpj CHAR(14) NOT NULL COMMENT 'Só dígitos',
  desenvolvedor_ie VARCHAR(14) NOT NULL DEFAULT '' COMMENT 'Só dígitos',
  desenvolvedor_im VARCHAR(14) NOT NULL DEFAULT '' COMMENT 'Só dígitos',
  desenvolvedor_endereco VARCHAR(150) NOT NULL DEFAULT '',
  desenvolvedor_telefone VARCHAR(20) NOT NULL DEFAULT '' COMMENT 'Só dígitos, com DDD',
  desenvolvedor_responsavel VARCHAR(60) NOT NULL DEFAULT '' COMMENT 'Responsável técnico',
  arq_bd VARCHAR(120) NOT NULL COMMENT 'Arquitetura do banco (Requisito VI, I, c), com o provedor quando na nuvem',
  arq_sist VARCHAR(120) NOT NULL COMMENT 'Arquitetura de execução (Requisito VI, I, d), com o provedor quando na nuvem',
  criado_em DATETIME NOT NULL,
  atualizado_em DATETIME NULL,
  PRIMARY KEY (id),
  CONSTRAINT ck_sys_paf_uma_linha CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ===== Reversão =====
-- DROP TABLE sys_paf;
