-- TEF SiTEF por caixa (Agente CliSiTef instalado no computador do caixa, com o PinPad).
-- Preenchido no cadastro do caixa (BM-Master). Com as três colunas preenchidas, o PDV passa crédito, débito,
-- vales e PIX pelo SiTEF; vazias, o pagamento com cartão segue lançado à mão (maquininha à parte).
-- Rodar no bmerp_000000. Reversão no fim do arquivo.

ALTER TABLE pdv_caixas
  ADD COLUMN sitef_ip VARCHAR(100) NULL COMMENT 'Endereço do servidor SiTEF (IP ou nome; vários separados por ;)' AFTER descricao,
  ADD COLUMN sitef_loja VARCHAR(8) NULL COMMENT 'Código da loja no SiTEF (8 caracteres)' AFTER sitef_ip,
  ADD COLUMN sitef_terminal VARCHAR(8) NULL COMMENT 'Código do terminal no SiTEF (8 caracteres, ex.: SE000001)' AFTER sitef_loja;

-- ===== Reversão =====
-- ALTER TABLE pdv_caixas DROP COLUMN sitef_ip, DROP COLUMN sitef_loja, DROP COLUMN sitef_terminal;
