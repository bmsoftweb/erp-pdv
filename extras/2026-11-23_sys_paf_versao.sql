-- PAF-NFC-e único (erp-pdv + erp-vendas, decisão de 23/11/2026): uma versão só do PAF, gravada no banco.
-- Vai no verProc das notas dos dois sistemas e no registro 3 (U3, D3, W3) dos arquivos do Menu Fiscal.
-- Atualizar a cada versão publicada do PAF. Rodar no bmerp_000000. Reversão no fim do arquivo.

ALTER TABLE sys_paf
  ADD COLUMN versao VARCHAR(10) NOT NULL DEFAULT '' COMMENT 'Versão do PAF-NFC-e (verProc e registro 3 do Menu Fiscal)' AFTER arq_sist;

UPDATE sys_paf SET versao = '0.1.6', atualizado_em = NOW() WHERE id = 1;

-- ===== Reversão =====
-- ALTER TABLE sys_paf DROP COLUMN versao;
