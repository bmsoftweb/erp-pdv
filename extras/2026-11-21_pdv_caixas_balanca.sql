-- Balança de checkout por caixa (peso pela porta serial/USB-serial, lido pelo navegador com Web Serial).
-- Configurada no cadastro do caixa (BM-Master → Empresas → Configurações → Caixas (PDV)). A porta COM é escolhida
-- uma vez no próprio computador (PDV → Mais → Configurar balança). Protocolo ENQ → STX peso ETX (Toledo, Filizola,
-- Elgin, Urano no modo compatível). Velocidade e formato conforme o manual da balança.
-- Rodar no bmerp_000000. Reversão no fim do arquivo.

ALTER TABLE pdv_caixas
  ADD COLUMN balanca TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = caixa com balança: o PDV lê o peso dos produtos vendidos por kg' AFTER teclado_virtual,
  ADD COLUMN balanca_velocidade INT NOT NULL DEFAULT 2400 COMMENT 'Velocidade da porta (bps): 2400, 4800, 9600…' AFTER balanca,
  ADD COLUMN balanca_formato CHAR(3) NOT NULL DEFAULT '8N1' COMMENT 'Bits de dados, paridade (N/E/O) e bits de parada: 8N1, 7E1…' AFTER balanca_velocidade;

-- ===== Reversão =====
-- ALTER TABLE pdv_caixas DROP COLUMN balanca_formato, DROP COLUMN balanca_velocidade, DROP COLUMN balanca;
