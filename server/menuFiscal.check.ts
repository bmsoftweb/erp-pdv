/** Conferência do Arquivo I contra o leiaute (tamanho e campos). Rode com: npx tsx --env-file=.env server/menuFiscal.check.ts */
import assert from 'node:assert/strict';
import { pool } from './db.js';
import { arquivoI } from './menuFiscal.js';

const chave = (tpEmis: string, modelo: string) => `422611085119510001376500100000000${modelo === '55' ? '2' : '1'}`.slice(0, 34).padEnd(34, '0') + tpEmis + '123456789';

// Banco de mentira: cada consulta do arquivoI devolve um exemplo
(pool as any).query = async (sql: string) => {
  if (sql.includes('FROM sys_empresas')) return [[{ inscricao_municipal: '12345' }]];
  if (sql.includes('FROM mov_nfce_pagamentos')) return [[{ data: '2026-11-20', codigo: '001', tpag: '03', modelo: '65', valor: '10.50' }]];
  if (sql.includes('fis_grupos_tributarios'))
    return [[{ id: 7, sku: 'CAFE500', nome: 'Café Torrado 500g', ncm: '09012100', cest: '1709600', preco_venda: '12.34', iat: 'T', ippt: 'T', unidade: 'PCT', cst_icms: '00', aliquota_icms: '17', cst_ibscbs: '000', cclass_trib: '000001' }]];
  if (sql.includes('MIN(data_emissao)')) return [[{ inicio: '2026-11-20 08:01:02' }]];
  if (sql.includes('est_estoque_saldo')) return [[{ id: 7, sku: 'CAFE500', nome: 'Café Torrado 500g', unidade: 'PCT', estoque: '-2.5' }]];
  if (sql.includes('FROM nfe_documentos'))
    return [[
      { modelo: '65', serie: 1, numero: 15, chave: chave('1', '65'), valor_total: '22.00', destinatario_documento: '52998224725', emissao: '2026-11-20', recebimento: '<dhRecbto>2026-11-20' },
      { modelo: '65', serie: 1, numero: 16, chave: chave('9', '65'), valor_total: '5.00', destinatario_documento: null, emissao: '2026-11-20', recebimento: null },
      { modelo: '55', serie: 1, numero: 3, chave: chave('1', '55'), valor_total: '100.00', destinatario_documento: '08511951000137', emissao: '2026-11-20', recebimento: '<dhRecbto>2026-11-20' },
      { modelo: '55', serie: 1, numero: 4, chave: chave('6', '55'), valor_total: '1.00', destinatario_documento: '08511951000137', emissao: '2026-11-20', recebimento: null },
    ]];
  throw new Error('consulta inesperada: ' + sql.slice(0, 60));
};

process.env.PAF_DESENVOLVEDOR_CNPJ = '08511951000137';
process.env.PAF_DESENVOLVEDOR_RAZAO = 'BMSoft Sistemas Ltda';
const emit = { id: 1, cnpj: '08511951000137', inscricao_estadual: '255.123.456', razao_social: 'Mercado São João' };
const texto = (await arquivoI(emit, 1, 0, { estoque: 'total' }))!;
assert.ok(texto.endsWith('\r\n'));
const linhas = texto.split('\r\n').slice(0, -1);
const TAMANHO: Record<string, number> = { U1: 94, U2: 94, U3: 62, A2: 35, P2: 176, E2: 151, J1: 92, J2: 100, N1: 96, N2: 103 };
assert.deepEqual(linhas.map((l) => l.slice(0, 2)), ['U1', 'U2', 'U3', 'A2', 'P2', 'E2', 'J1', 'J2', 'N1', 'N2']);
for (const l of linhas) {
  assert.equal(l.length, TAMANHO[l.slice(0, 2)], `${l.slice(0, 2)} com ${l.length} posições`);
  assert.ok(/^[\x20-\x7E]+$/.test(l), `${l.slice(0, 2)} fora do ASCII`);
}
const [u1, , , a2, p2, e2, j1, j2, n1] = linhas;
assert.equal(u1.slice(44, 94).trim(), 'MERCADO SAO JOAO');
assert.equal(a2, 'A2' + '20261120' + '001       ' + '03' + '1' + '000000001050');
assert.equal(p2.slice(137, 139), 'TT'); // IAT, IPPT
assert.equal(p2.slice(141, 145), '1700'); // alíquota 17%
assert.equal(p2.slice(162, 176), '00000000001234'); // 12,34
assert.equal(e2.slice(122, 135), '-000000002500'); // −2,500
assert.equal(e2.slice(143, 151), '20261120'); // posição na abertura do dia
assert.equal(j1.slice(81, 92), '52998224725');
assert.equal(j2.slice(10, 18), '01/01/99'); // ainda sem autorização
assert.equal(n1.charAt(24), '1'); // tpEmis
console.log('menu fiscal: ok');
process.exit(0);
