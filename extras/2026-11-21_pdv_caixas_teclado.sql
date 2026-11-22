-- Teclado virtual por caixa (computador com tela touch, sem teclado físico).
-- Marcado no cadastro do caixa (BM-Master → Empresas → Configurações → Caixas (PDV)). Ligado, o PDV deste computador
-- abre com o teclado virtual na tela (login inclusive). No caixa, o menu "Mais" ainda liga/desliga até fechar o navegador.
-- Rodar no bmerp_000000. Reversão no fim do arquivo.

ALTER TABLE pdv_caixas
  ADD COLUMN teclado_virtual TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = tela touch: o PDV mostra o teclado virtual' AFTER sitef_terminal;

-- ===== Reversão =====
-- ALTER TABLE pdv_caixas DROP COLUMN teclado_virtual;
