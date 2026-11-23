/** Conferência do Arquivo I contra o leiaute (tamanho e campos). Rode com: npx tsx --env-file=.env server/menuFiscal.check.ts */
import assert from 'node:assert/strict';
import { pool } from './db.js';
import { arquivoI, arquivoII, arquivoIII, documentosXml } from './menuFiscal.js';

const chave = (tpEmis: string, modelo: string) => `422611085119510001376500100000000${modelo === '55' ? '2' : '1'}`.slice(0, 34).padEnd(34, '0') + tpEmis + '123456789';

// Banco de mentira: cada consulta do arquivoI devolve um exemplo
let semRe = false;
let sqlXml = '';
let semCst = false;
(pool as any).query = async (sql: string) => {
  if (sql.includes('COALESCE(xml_protocolo, xml)')) return (sqlXml = sql), [[]];
  // Arquivo III (Controle dos DAV) e II (Requisições Externas)
  if (sql.includes('FROM ven_dav_itens_log'))
    return [[{ numero: 7, tipo: 'A', descricao: 'Café Torrado 500g', unidade: 'PCT', quantidade: '2.0000', preco_unitario: '12.34', quando: '2026-11-20 10:11:12', codigo: '7891000100103' }]];
  if (sql.includes('FROM ven_dav_itens i JOIN'))
    return [[{ numero: 7, item: 1, descricao: 'Café Torrado 500g', unidade: 'PCT', quantidade: '3.0000', preco_unitario: '12.34', valor_desconto: '1.02', valor_total: '36.00', incluido_em: '2026-11-20', codigo: '7891000100103', cst_icms: '00', aliquota_icms: '17', cst_ibscbs: '000', cclass_trib: '000001' },
      // removido do DAV (cancelado = 1): vai no D5 com "S" e fica fora do subtotal do D4
      { numero: 7, item: 2, descricao: 'Leite 1L', unidade: 'UN', quantidade: '2.0000', preco_unitario: '5.00', valor_desconto: '0', valor_total: '10.00', incluido_em: '2026-11-20', codigo: '8', cancelado: 1, cst_icms: '60', aliquota_icms: '17', cst_ibscbs: '200', cclass_trib: '200003' },
    ]];
  if (sql.includes('FROM ven_davs d LEFT JOIN cad_pessoas'))
    return [[{ id: 1, numero: 7, tipo: 'pedido', prevenda_senha: '123456', data_emissao: '2026-11-20', valor_produtos: '37.02', valor_frete: '5.00', valor_total: '41.00', cliente: 'José da Silva', cpf_cnpj: '52998224725', situacao: 'A' }]];
  if (sql.includes('FROM ven_requisicoes_externas'))
    return [semRe ? [] : [
      { cre: 1, origem: 'BM-CRM', status: 'atendida', codigo_pedido: 'PED-15', valor_total: '41.00', dav: 7 },
      { cre: 2, origem: 'BM-CRM', status: 'denegada', codigo_pedido: 'PED-16', valor_total: '0', dav: null },
    ]];
  if (sql.includes('FROM nfe_config')) return [[{ ambiente: '2' }]];
  if (sql.includes('FROM sys_empresas')) return [[{ inscricao_municipal: '12345' }]];
  if (sql.includes('FROM sys_paf')) return [[{ desenvolvedor_cnpj: '08511951000137', desenvolvedor_razao: 'BMSoft Sistemas Ltda', desenvolvedor_ie: '', desenvolvedor_im: '', versao: '9.8.7' }]];
  if (sql.includes('FROM mov_nfce_pagamentos')) return [[{ data: '2026-11-20', codigo: '001', tpag: '03', modelo: '65', valor: '10.50' }]];
  // erp-vendas (PAF único): mesma data, meio, modelo e intermediador do caixa → soma num A2 só.
  // Venda de 9,50 paga com 4,50 no cartão e 10,00 em dinheiro: 5,00 de troco saem do dinheiro
  if (sql.includes('ven_venda_parcelas'))
    return [[
      { venda: 1, total: '9.50', data: '2026-11-20', codigo: '001', forma_pagamento: 'Cartão de crédito', modelo: '65', valor: '4.50' },
      { venda: 1, total: '9.50', data: '2026-11-20', codigo: '001', forma_pagamento: 'Dinheiro', modelo: '65', valor: '10.00' },
      // Sem pagamento (90): a parcela leva o valor da venda, a nota vPag 0 → sem A2
      { venda: 2, total: '7.00', data: '2026-11-20', codigo: '001', forma_pagamento: 'Sem pagamento', modelo: '65', valor: '7.00' },
    ]];
  // NF-e digitada na tela do erp-nfe: 20,00 em dinheiro com 2,00 de troco; intermediador pelo CNPJ do estabelecimento
  if (sql.includes('referencia IS NULL')) return [[{ data: '2026-11-20', modelo: '55', total: '18.00', pagamentos: '[{"forma":"01","valor":20}]', troco: '2' },
    // digitada sem pagamento (90): também sem A2
    { data: '2026-11-20', modelo: '65', total: '3.00', pagamentos: '[{"forma":"90","valor":3}]', troco: null },
  ]];
  if (sql.includes('FROM cad_intermediadores')) return [[{ codigo: '001', cnpj: '08511951000137' }]];
  if (sql.includes('fis_grupos_tributarios'))
    return [[
      { id: 7, codigo_barras: '7891000100103', nome: 'Café Torrado 500g', ncm: '09012100', cest: '1709600', preco_venda: '12.34', iat: 'T', ippt: 'T', unidade: 'PCT', cst_icms: '00', aliquota_icms: '17', cst_ibscbs: '000', cclass_trib: '000001' },
      // Simples com ST: CST 60 sai sem alíquota; cesta básica (CST IBS/CBS 200) sai sem IBS
      { id: 8, codigo_barras: null, nome: 'Leite 1L', ncm: '04012010', cest: '1702000', preco_venda: '5.00', iat: 'A', ippt: 'T', unidade: 'UN', cst_icms: semCst ? null : '60', aliquota_icms: '17', cst_ibscbs: '200', cclass_trib: '200003' },
    ]];
  if (sql.includes('MIN(data_emissao)')) return [[{ inicio: '2026-11-20 08:01:02' }]];
  if (sql.includes('est_estoque_saldo')) return [[{ id: 7, codigo_barras: '7891000100103', nome: 'Café Torrado 500g', unidade: 'PCT', estoque: '-2.5' }]];
  if (sql.includes('FROM nfe_documentos'))
    return [[
      { modelo: '65', serie: 1, numero: 15, chave: chave('1', '65'), valor_total: '22.00', destinatario_documento: '52998224725', emissao: '2026-11-20', recebimento: '<dhRecbto>2026-11-20' },
      { modelo: '65', serie: 1, numero: 16, chave: chave('9', '65'), valor_total: '5.00', destinatario_documento: null, emissao: '2026-11-20', recebimento: null },
      // série textual: "10 " vem antes de "2  " (fora de ordem aqui de propósito)
      { modelo: '65', serie: 2, numero: 1, chave: chave('1', '65'), valor_total: '1.00', destinatario_documento: null, emissao: '2026-11-20', recebimento: '<dhRecbto>2026-11-20' },
      { modelo: '65', serie: 10, numero: 1, chave: chave('1', '65'), valor_total: '1.00', destinatario_documento: null, emissao: '2026-11-20', recebimento: '<dhRecbto>2026-11-20' },
      // normal autorizada e cancelada pelo art. 105 (dados.normal da contingência 16): vem da 2ª parte do UNION
      ...(sql.includes("'$.normal.resolvida'") ? [{ modelo: '65', serie: 1, numero: '14', chave: chave('1', '65'), valor_total: '5.00', destinatario_documento: null, emissao: '2026-11-20', recebimento: null }] : []),
      { modelo: '55', serie: 1, numero: 3, chave: chave('1', '55'), valor_total: '100.00', destinatario_documento: '08511951000137', emissao: '2026-11-20', recebimento: '<dhRecbto>2026-11-20' },
      { modelo: '55', serie: 1, numero: 4, chave: chave('6', '55'), valor_total: '1.00', destinatario_documento: '08511951000137', emissao: '2026-11-20', recebimento: null },
    ]];
  throw new Error('consulta inesperada: ' + sql.slice(0, 60));
};

const emit = { id: 1, cnpj: '08511951000137', inscricao_estadual: '255.123.456', razao_social: 'Mercado São João' };
const texto = (await arquivoI(emit, 1, 0, { estoque: 'total' }))!;
assert.ok(texto.endsWith('\r\n'));
const linhas = texto.split('\r\n').slice(0, -1);
const TAMANHO: Record<string, number> = { U1: 94, U2: 94, U3: 62, A2: 35, P2: 176, E2: 151, J1: 92, J2: 100, N1: 96, N2: 103 };
// J1/N1 com todas as notas (a de contingência também), J2/N2 só as de contingência (6.7.1 a 6.10.1)
assert.deepEqual(linhas.map((l) => l.slice(0, 2)), ['U1', 'U2', 'U3', 'A2', 'A2', 'A2', 'P2', 'P2', 'E2', 'J1', 'J1', 'J1', 'J1', 'J1', 'J2', 'N1', 'N1', 'N2']);
for (const l of linhas) {
  assert.equal(l.length, TAMANHO[l.slice(0, 2)], `${l.slice(0, 2)} com ${l.length} posições`);
  assert.ok(/^[\x20-\x7E]+$/.test(l), `${l.slice(0, 2)} fora do ASCII`);
}
const [u1, u2, u3, a2din, a2nfe, a2, p2, p2st, e2, j1n, j1, j1c, j1s10, j1s2, j2, n1, n1c] = linhas;
assert.equal(u1.slice(44, 94).trim(), 'MERCADO SAO JOAO');
assert.equal(u2.slice(2, 16) + u2.slice(44, 94).trim(), '08511951000137BMSOFT SISTEMAS LTDA'); // vem da sys_paf
assert.equal(u3, 'U3' + 'BM-PDV'.padEnd(50) + '9.8.7'.padEnd(10)); // versão da sys_paf
assert.equal(a2, 'A2' + '20261120' + '001       ' + '03' + '1' + '000000001500');
assert.equal(a2din, 'A2' + '20261120' + '001       ' + '01' + '1' + '000000000500'); // 10,00 − 5,00 de troco
assert.ok(!linhas.some((l) => l.startsWith('A2') && l.slice(20, 22) === '90')); // Sem pagamento (vPag 0) não gera A2
assert.equal(a2nfe, 'A2' + '20261120' + '001       ' + '01' + '2' + '000000001800'); // digitada no erp-nfe: 20,00 − 2,00
// J1 da normal cancelada (art. 105) e ordem por data, série textual e número
assert.deepEqual([j1n, j1, j1c, j1s10, j1s2].map((l) => l.slice(78, 81) + l.slice(68, 78)), ['1  0000000014', '1  0000000015', '1  0000000016', '10 0000000001', '2  0000000001']);
// Exportação XML: a contingência recusada e a normal cancelada vão junto
await documentosXml(1, 2, ['65'], '2026-11-20', '2026-11-20');
assert.ok(sqlXml.includes("situacao = 'rejeitada' AND SUBSTRING(chave, 35, 1) = '9'"));
assert.ok(sqlXml.includes("'$.normal.xml'") && sqlXml.includes("IN ('cancelada', 'estornar', 'denegada')") && sqlXml.includes("'$.normal.autorizada')) = 'true'"));
assert.equal(p2.slice(137, 139), 'TT'); // IAT, IPPT
assert.equal(p2.slice(141, 145), '1700'); // alíquota 17%
assert.equal(p2.slice(154, 158), '0010'); // IBS UF 0,10% no CST 000
assert.equal(p2st.slice(139, 145), '600000'); // CST 60: alíquota zerada
assert.equal(p2st.slice(154, 158), '0000'); // CST IBS/CBS 200: sem IBS UF
assert.equal(p2.slice(162, 176), '00000000001234'); // 12,34
assert.equal(e2.slice(122, 135), '-000000002500'); // −2,500
assert.equal(e2.slice(143, 151), '20261120'); // posição na abertura do dia
assert.equal(j1.slice(81, 92), '52998224725');
assert.equal(j2.slice(10, 18), '01/01/99'); // ainda sem autorização
assert.equal(n1.charAt(24), '1'); // tpEmis
assert.equal(j1c.slice(69, 78), j2.slice(77, 86).slice(0, 9)); // a NFC-e 16 de contingência está no J1 e no J2
assert.equal(n1c.charAt(24), '6'); // NF-e de contingência no N1 com o tpEmis dela

// Produto sem CST do ICMS: o Menu Fiscal recusa e lista o produto, em vez de sair "00" no P2
semCst = true;
await assert.rejects(arquivoI(emit, 1, 0, { estoque: 'total' }), /Tributação incompleta.*8 Leite 1L/);
semCst = false;

// Arquivo III: D1..D6 com o tamanho do leiaute
const tamanhos = (t: string) => t.split('\r\n').slice(0, -1).map((l) => `${l.slice(0, 2)}:${l.length}`);
const t3 = (await arquivoIII(emit, 1, { situacao: 'todos' }))!;
assert.deepEqual(tamanhos(t3), ['D1:94', 'D2:94', 'D3:62', 'D4:170', 'D5:225', 'D5:225', 'D6:177']);
const d4 = t3.split('\r\n')[3];
assert.equal(d4.slice(2, 15), '0000000007   '); // número do DAV: 10 dígitos + 3 brancos
assert.equal(d4.slice(23, 53).trim(), 'PRE-VENDA');
assert.equal(d4.slice(53, 73).trim(), '123456');
assert.equal(d4.charAt(169), 'A'); // situação
// 06 = itens líquidos não cancelados (37,02 − 1,02 de desconto = 36,00), 07 = frete 5,00, 08 = 41,00: 06 + 07 = 08
assert.equal(d4.slice(73, 87) + d4.slice(87, 101) + d4.slice(101, 115), '00000000003600' + '00000000000500' + '00000000004100');
const [d5, d5c] = t3.split('\r\n').slice(4, 6);
assert.equal(d5.charAt(222) + d5c.charAt(222), 'NS'); // campo 18: indicador de cancelamento
// Arquivo II: W1..W4; denegada com DAV, pedido e valor zerados
const t2 = (await arquivoII(emit, 1, { situacao: 'todas' }))!;
assert.deepEqual(tamanhos(t2), ['W1:94', 'W2:94', 'W3:62', 'W4:179', 'W4:179']);
const [, , , w4a, w4d] = t2.split('\r\n');
assert.equal(w4a.slice(102, 112), 'A000000001');
assert.equal(w4d.slice(102, 112), 'D000000002');
assert.equal(w4d.slice(112), '0'.repeat(67));
// Sem dados no filtro: null, que vira "SEM INFORMACOES" com nroArquivo 0 (Requisito VI, § 8º)
semRe = true;
assert.equal(await arquivoII(emit, 1, { situacao: 'recebida' }), null);
console.log('menu fiscal: ok');
process.exit(0);
