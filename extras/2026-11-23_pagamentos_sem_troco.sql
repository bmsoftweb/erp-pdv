-- Tira o troco do dinheiro nos pagamentos do caixa já gravados (mov_nfce_pagamentos).
-- Antes, o tPag 01 guardava o valor entregue; agora a venda grava o dinheiro sem o troco (server/notas.ts), e o
-- A2 do Arquivo I soma o que ficou no caixa, igual ao total do J1/N1.
-- Excesso = soma dos pagamentos da venda − mov_nfce.valor; sai do dinheiro, na ordem de gravação (id), como na venda nova.
-- Rodar no bmerp_000000.
--
-- SEM REVERSÃO AUTOMÁTICA: faça backup de mov_nfce_pagamentos antes de rodar
-- (ex.: mysqldump bmerp_000000 mov_nfce_pagamentos > mov_nfce_pagamentos_antes.sql).

-- 1) Conferência: o que vai mudar (valor atual → novo)
SELECT p.id, p.mov_nfce_id_app, p.empresa_id, p.data, p.valor AS valor_atual, c.desconta, p.valor - c.desconta AS valor_novo
  FROM mov_nfce_pagamentos p
  JOIN (SELECT x.id,
               LEAST(x.valor, GREATEST(0, e.excesso - (SUM(x.valor) OVER (PARTITION BY x.mov_nfce_id_app ORDER BY x.id) - x.valor))) AS desconta
          FROM mov_nfce_pagamentos x
          JOIN (SELECT p.mov_nfce_id_app, SUM(p.valor) - n.valor AS excesso
                  FROM mov_nfce_pagamentos p JOIN mov_nfce n ON n.id_app = p.mov_nfce_id_app
                 GROUP BY p.mov_nfce_id_app, n.valor
                HAVING excesso > 0) e ON e.mov_nfce_id_app = x.mov_nfce_id_app
         WHERE x.tpag = '01') c ON c.id = p.id
 WHERE c.desconta > 0
 ORDER BY p.mov_nfce_id_app, p.id;

-- 2) Correção
UPDATE mov_nfce_pagamentos p
  JOIN (SELECT x.id,
               LEAST(x.valor, GREATEST(0, e.excesso - (SUM(x.valor) OVER (PARTITION BY x.mov_nfce_id_app ORDER BY x.id) - x.valor))) AS desconta
          FROM mov_nfce_pagamentos x
          JOIN (SELECT p.mov_nfce_id_app, SUM(p.valor) - n.valor AS excesso
                  FROM mov_nfce_pagamentos p JOIN mov_nfce n ON n.id_app = p.mov_nfce_id_app
                 GROUP BY p.mov_nfce_id_app, n.valor
                HAVING excesso > 0) e ON e.mov_nfce_id_app = x.mov_nfce_id_app
         WHERE x.tpag = '01') c ON c.id = p.id
   SET p.valor = p.valor - c.desconta
 WHERE c.desconta > 0;

-- ===== Reversão =====
-- Não há: restaurar o backup feito antes.
