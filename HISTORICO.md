# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.1.10 — 2026-11-24

- E-mail da nota: sai pelo erp-nfe com a conta de e-mail da empresa gravada no BM-Master.

## 0.1.9 — 2026-11-23

- Marca BM na tela: mensagens e textos citam o "BM-Master" (no lugar de "ERP-Master"). Vale para o token do caixa, o aviso da balança e os erros de registro.

## 0.1.8 — 2026-11-23

- Custo médio nas saídas: as vendas gravam `custo_medio` e `estoque_valor` no movimento, mantendo o médio da filial (mesma conta do erp-compras).
- Nome "ERP-Master" no lugar de "BM-Master" em mensagens e comentários.

## 0.1.7 — 2026-11-23

- PAF-NFC-e (Ato DIAT 54/2026 e RICMS/SC Anexo 11), adequações da auditoria:
  - Venda: cupom conferido antes de cobrar (TEF/PIX); recusa serviço, produto inativo, grupo tributário sem CST do ICMS/IBS-CBS e cClassTrib; intermediador escolhido em todo pagamento (só tipo P); troco só de dinheiro e menor que ele; dinheiro gravado sem o troco; CPF com IE no cadastro sai em NF-e; código impresso = GTIN ou id.
  - Contingência: DANFE em duas vias (via do estabelecimento), aviso de fila parada com o prazo do art. 104 § 1º, reimpressão da nota gerada de novo, "Gerar de novo" da contingência recusada, aviso de NF-e de estorno (art. 106), números abandonados com opção de inutilizar (art. 108), registro da venda que falha reenviado.
  - Menu Fiscal: aviso "MENU FISCAL INACESSÍVEL NESTA TELA" em todas as telas e botão no caixa livre; Arquivo I com J1/N1 de todas as notas e J2/N2 da contingência, A2 sem troco e sem "Sem pagamento" e com as notas do erp-vendas e do erp-nfe, P2/E2 com inativos e sem CST inventado, estoque parcial por código, id ou nome, ordem por série; Arquivo III com D4 fechando e item cancelado do DAV; filtro de ambiente; data da última atualização pela `sys_paf`.
  - EConf só com pagamento eletrônico.
- Clube de descontos: associado com o CPF na venda leva o preço das listas do clube (script `extras/2026-11-22_clube_descontos.sql`).
- Scripts: `extras/2026-11-23_sys_paf_versao.sql` e `extras/2026-11-23_pagamentos_sem_troco.sql` (tira o troco dos pagamentos antigos; fazer backup antes).

## 0.1.6 — 2026-11-21

- Caixas cadastrados no BM-Master (`pdv_caixas`): o computador se registra com o token do caixa; teclado virtual, TEF SiTEF e balança configurados por caixa (scripts `extras/2026-11-20_pdv_caixas*.sql` e `extras/2026-11-21_pdv_caixas_*.sql`).
- TEF pelo SiTEF (CliSiTef) no lugar do SuperTEF; PIX cobrado no banco pelo BMBancos, com QR Code na tela e baixa automática (`BANCOS_URL`/`BANCOS_SECRET`).
- Vitrine de imagens no caixa e tela do cliente em segundo monitor (`pdv_imagens`, scripts `extras/2026-11-20_pdv_imagens.sql` e `extras/2026-11-21_pdv_imagens_tela.sql`).
- Pesquisa por categoria (código 77) com fotos dos produtos, para hortifrúti e padaria (script `extras/2026-11-21_categorias_pdv_pesquisa.sql`).
- Balança de checkout pela porta serial/USB (Web Serial, protocolo ENQ/STX): produto por kg pede o peso, tecla `*` lê de novo; quantidade sempre com 3 casas.
- Teclado virtual menor.
- RICMS/SC Anexo 11: código interno ou GTIN inválido vai como "SEM GTIN" (arts. 96 VIII e 99 § 1º); venda a partir de R$ 200.000,00 sai em NF-e (art. 96 § 7º); cancelamento da NFC-e só até 30 min da autorização, depois orienta a NF-e de estorno (art. 106); XML e DANFE ao cliente por e-mail ou download em Notas emitidas (art. 103 § 5º).

## 0.1.5 — 2026-11-20

- Publicação na Vercel: a API caía ao carregar o `package.json` (import de JSON sem `with { type: 'json' }`); variáveis de ambiente cadastradas no projeto.

## 0.1.4 — 2026-11-20

- Dados da empresa desenvolvedora e da arquitetura do PAF-NFC-e (Identificação do Menu Fiscal, registro U2 do Arquivo I e arqBD/arqSist do XML) passam a vir da tabela `sys_paf`, uma linha para todo o ERP (script `extras/2026-11-20_sys_paf.sql`); saem as variáveis `PAF_*` do `.env`.

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
