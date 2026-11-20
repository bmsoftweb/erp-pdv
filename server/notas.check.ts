/** Conferência da montagem da nota do PDV (IAT, desconto rateado, troco, modelo). Rode com: npx tsx --env-file=.env server/notas.check.ts */
import assert from 'node:assert/strict';
import { pool } from './db.js';
import { comST, montarDocumento } from './notas.js';

const grupoTrib = { grupo_trib_id: 1, grupo_descricao: 'Revenda', grupo_ativo: 1, origem: 0, cfop_dentro_uf: '5102', cfop_fora_uf: '6102', csosn: '102', aliquota_credito_sn: 0, cst_icms: null, aliquota_icms: 0, cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0, cst_ibscbs: null, cclass_trib: null };
(pool as any).query = async (sql: string) => {
  if (sql.includes('FROM nfe_series')) return [[{ serie: 1 }]];
  if (sql.includes('FROM cad_produtos p'))
    return [[
      { id: 1, sku: 'A', nome: 'Arroz', ncm: '10063021', codigo_barras: '7891234567895', unidade: 'UN', preco_venda: '10.00', iat: 'A', ...grupoTrib },
      { id: 2, sku: 'B', nome: 'Bala', ncm: '17049020', codigo_barras: null, unidade: 'UN', preco_venda: '3.333', iat: 'T', ...grupoTrib },
    ]];
  if (sql.includes('FROM cad_intermediadores')) return [[{ id: 5, tipo: 'P', nome_fantasia: 'LOJA', cnpj: '08511951000137' }, { id: 6, tipo: 'P', nome_fantasia: 'REDE', cnpj: '01425787000104' }]];
  throw new Error('consulta inesperada: ' + sql.slice(0, 60));
};

const emit = { id: 1, crt: 1, uf: 'SC' };
const venda = {
  idApp: '2026112010000000012345678',
  itens: [{ produtoId: 1, quantidade: 3, valorUnitario: 10 }, { produtoId: 2, quantidade: 3, valorUnitario: 3.333 }],
  consumidor: { documento: '529.982.247-25' },
  pagamentos: [{ tPag: '01', valor: 50, intermediadorId: 5 }],
  ajusteTotal: -1,
};

// 3 × 10,00 = 30,00 (A) e 3 × 3,333 = 9,999 → 9,99 (T); desconto de 1,00 rateado: 0,75 + 0,25
const m = await montarDocumento(venda as any, emit, 0, 1);
const d: any = m.documento;
assert.equal(m.modelo, '65');
assert.equal(m.totalNota, 38.99);
assert.deepEqual(d.itens.map((i: any) => [i.valorTotal, i.valorDesconto]), [[30, 0.75], [9.99, 0.25]]);
assert.equal(d.itens[0].ean, '7891234567895');
assert.equal(d.itens[1].ean, undefined); // sem GTIN
assert.equal(d.troco, 11.01);
assert.deepEqual(d.destinatario, { cpf: '52998224725', nome: '', indIEDest: 9 });
assert.deepEqual(d.informacoesAdicionais.obsFisco, [{ campo: 'PAF', texto: 'BM-PDV' }]);
assert.equal(d.ide.indicadorIntermediador, 0);

// Sem discriminar: o item sai pelo líquido (29,25 = 3 × 9,75), sem vDesc
const s = await montarDocumento({ ...venda, discriminarAjustes: false } as any, emit, 0, 1);
assert.deepEqual((s.documento as any).itens.map((i: any) => [i.valorUnitario, i.valorTotal, i.valorDesconto]), [[9.75, 29.25, undefined], [3.2466666667, 9.74, undefined]]);

// Cartão: grupo card com o CNPJ do intermediador; troco sem dinheiro é recusado
const c = await montarDocumento({ ...venda, ajusteTotal: 0, pagamentos: [{ tPag: '03', valor: 39.99, intermediadorId: 6, bandeira: '2', autorizacao: 'X1' }] } as any, emit, 0, 1);
assert.deepEqual((c.documento as any).pagamentos[0].cartao, { integracao: 2, cnpj: '01425787000104', bandeira: '02', autorizacao: 'X1' });
await assert.rejects(montarDocumento({ ...venda, ajusteTotal: 0, pagamentos: [{ tPag: '03', valor: 50, intermediadorId: 6 }] } as any, emit, 0, 1), /Troco só em pagamento com dinheiro/);
await assert.rejects(montarDocumento({ ...venda, pagamentos: [{ tPag: '01', valor: 50, intermediadorId: 0 }] } as any, emit, 0, 1), /intermediador/);

// CEST só com substituição tributária: CSOSN 500 (Simples) e CST 60 (normal) exigem; CSOSN 102 não
assert.equal(comST({ csosn: '500' }, true), true);
assert.equal(comST({ csosn: '102', cst_icms: '60' }, true), false);
assert.equal(comST({ cst_icms: '60' }, false), true);
assert.equal(comST({ cst_icms: '00' }, false), false);

console.log('notas: ok');
process.exit(0);
