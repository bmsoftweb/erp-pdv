-- Cadastro de caixas (computadores do PDV) por filial, feito no BM-Master (Empresas → Configurações → Caixas (PDV)).
-- O token é digitado uma vez no computador do caixa (tela de login → "Registrar este computador"): daí em diante
-- ele só entra na filial do caixa e, com usuario_id preenchido, só com esse usuário (que também só entra por ele).
-- Rodar no bmerp_000000. Reversão no fim do arquivo.

CREATE TABLE pdv_caixas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id BIGINT UNSIGNED NOT NULL COMMENT 'sys_empresas.id: filial do caixa',
  numero SMALLINT UNSIGNED NOT NULL COMMENT 'Número do caixa na filial',
  descricao VARCHAR(60) NOT NULL DEFAULT '',
  usuario_id BIGINT UNSIGNED NULL COMMENT 'sys_usuarios.id: único usuário aceito; NULL = qualquer usuário liberado na filial',
  token CHAR(9) NOT NULL COMMENT 'NNNN-NNNN (só números) digitado no computador; gerar outro desliga o computador registrado',
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  registrado_em DATETIME NULL COMMENT 'Último registro do token num computador',
  ultimo_acesso DATETIME NULL COMMENT 'Último login neste caixa',
  ultimo_usuario_id BIGINT UNSIGNED NULL COMMENT 'sys_usuarios.id do último login',
  ultimo_ip VARCHAR(45) NOT NULL DEFAULT '',
  criado_em DATETIME NOT NULL,
  atualizado_em DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pdv_caixas_numero (empresa_id, numero),
  UNIQUE KEY uk_pdv_caixas_token (token),
  KEY ix_pdv_caixas_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ===== Reversão =====
-- DROP TABLE pdv_caixas;
