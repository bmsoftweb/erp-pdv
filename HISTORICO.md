# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.1.3 — 2026-11-20

- Venda recusa item com substituição tributária sem CEST (o PAF-NFC-e exige o cadastro completo, Requisito VII).

## 0.1.2 — 2026-11-20

- Abertura de caixa só com o troco inicial: saiu o arquivo de configuração (.ini), que não aplicava nenhum valor (série, número e chave vêm do erp-nfe).
- Base local sem a tabela de atalhos do .ini (versão 2 da base, apaga a tabela antiga).

## 0.1.1 — 2026-11-20

Primeiro envio ao repositório bmsoftweb/erp-pdv.

- Migrado do Next.js (AI Studio) para Vite + React + Express, no banco `bmerp_000000` e com o mesmo login do erp-vendas; credenciais só no `.env`.
- PAF-NFC-e SC (Ato DIAT 54/2026):
  - NFC-e emitida só pelo erp-nfe (concentrador); série, número e chave vêm de lá.
  - Contingência offline (tpEmis 9) quando a SEFAZ não responde, com transmissão automática a cada minuto e quando a internet volta; cancelamento e EConf bloqueados até a autorização.
  - Menu Fiscal: identificação do PAF (arquitetura em nuvem com o nome do provedor), Registros do PAF assinados e exportação dos XML, incluindo os eventos de cancelamento.
  - Cancelamento e conciliação financeira (EConf) pela lista de notas emitidas.
- PWA instalável que abre sem internet; a venda só é concluída com conexão (o cupom continua aberto).
- Base local no IndexedDB (Dexie): produtos sincronizados ao abrir e quando a internet volta. Saíram o sql.js e o arquivo `.db` físico.
- Leitura do código de barras: procura o código exato antes de tratar como etiqueta de balança.
- Intermediadores de pagamento: última lista guardada para usar sem conexão.
