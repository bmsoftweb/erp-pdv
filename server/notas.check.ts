/** Conferência da montagem da nota do PDV (IAT, desconto rateado, troco, modelo). Rode com: npx tsx --env-file=.env server/notas.check.ts */
import assert from 'node:assert/strict';
import { pool } from './db.js';
import { comST, montarDocumento } from './notas.js';

const grupoTrib = { grupo_trib_id: 1, grupo_descricao: 'Revenda', grupo_ativo: 1, origem: 0, cfop_dentro_uf: '5102', cfop_fora_uf: '6102', csosn: '102', aliquota_credito_sn: 0, cst_icms: null, aliquota_icms: 0, cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0, cst_ibscbs: null, cclass_trib: null };
(pool as any).query = async (sql: string, params: any[] = []) => {
  if (sql.includes('FROM nfe_series')) return [[{ serie: 1 }]];
  if (sql.includes('FROM sys_paf')) return [[{ versao: '9.8.7' }]];
  if (sql.includes('FROM cad_produtos p'))
    return [[
      { id: 1, ativo: 1, sku: 'A', nome: 'Arroz', ncm: '10063021', codigo_barras: '7891234567895', unidade: 'UN', preco_venda: '10.00', iat: 'A', ...grupoTrib, cst_ibscbs: '200', cclass_trib: '200003' },
      { id: 2, ativo: 1, sku: 'B', nome: 'Bala', ncm: '17049020', codigo_barras: null, unidade: 'UN', preco_venda: '3.333', iat: 'T', ...grupoTrib, cst_ibscbs: '000', cclass_trib: '000001', cst_is: '000', cclass_trib_is: '000001', aliquota_is: '10.0000' },
      { id: 3, ativo: 1, sku: 'C', nome: 'Café', ncm: '09012100', codigo_barras: null, unidade: 'UN', preco_venda: '20.00', iat: 'A', ...grupoTrib, cst_ibscbs: null, cclass_trib: null },
      { id: 4, ativo: 1, servico: 1, sku: 'D', nome: 'Frete', ncm: '00000000', codigo_barras: null, unidade: 'UN', preco_venda: '5.00', iat: 'A', ...grupoTrib, cst_ibscbs: '000', cclass_trib: '000001' },
    ]];
  // CPF 111.444.777-35: produtor com IE no cadastro
  if (sql.includes('FROM cad_pessoas'))
    return [params[0] === '11144477735' ? [{ nome: 'Produtor', ie: '255.123.456', cidade_ibge: '4205407', cidade_uf: 'SC', cidade_nome: 'Florianópolis', cep: '88000000' }] : []];
  if (sql.includes('FROM cad_intermediadores'))
    return [[{ id: 5, tipo: 'P', nome_fantasia: 'LOJA', cnpj: '08511951000137' }, { id: 6, tipo: 'P', nome_fantasia: 'REDE', cnpj: '01425787000104' }, { id: 7, tipo: 'T', nome_fantasia: 'MARKETPLACE', cnpj: '03007331000141' }]];
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
assert.equal(d.ide.versaoProcesso, 'BM-PDV 9.8.7'); // versão da sys_paf
// IBS UF e CBS só no CST 000 (cesta básica 200 sai zerada); Imposto Seletivo do grupo só onde há CST do IS
assert.deepEqual([d.itens[0].imposto.ibscbs.aliquotaIBSUF, d.itens[0].imposto.ibscbs.aliquotaCBS], [0, 0]);
assert.deepEqual([d.itens[1].imposto.ibscbs.aliquotaIBSUF, d.itens[1].imposto.ibscbs.aliquotaCBS], [0.1, 0.9]);
assert.equal(d.itens[0].imposto.seletivo, undefined);
assert.deepEqual(d.itens[1].imposto.seletivo, { cst: '000', classificacao: '000001', aliquota: 10 });
assert.equal(d.ide.indicadorIntermediador, 0);

// Sem discriminar: o item sai pelo líquido (29,25 = 3 × 9,75), sem vDesc
const s = await montarDocumento({ ...venda, discriminarAjustes: false } as any, emit, 0, 1);
assert.deepEqual((s.documento as any).itens.map((i: any) => [i.valorUnitario, i.valorTotal, i.valorDesconto]), [[9.75, 29.25, undefined], [3.2466666667, 9.74, undefined]]);

// Cartão: grupo card com o CNPJ do intermediador; troco sem dinheiro é recusado
const c = await montarDocumento({ ...venda, ajusteTotal: 0, pagamentos: [{ tPag: '03', valor: 39.99, intermediadorId: 6, bandeira: '2', autorizacao: 'X1' }] } as any, emit, 0, 1);
assert.deepEqual((c.documento as any).pagamentos[0].cartao, { integracao: 2, cnpj: '01425787000104', bandeira: '02', autorizacao: 'X1' });
// TEF: o CNPJ da credenciadora que o SiTEF devolveu vale no lugar do CNPJ do intermediador
const t = await montarDocumento({ ...venda, ajusteTotal: 0, pagamentos: [{ tPag: '04', valor: 39.99, intermediadorId: 6, integracao: 1, cnpjCredenciadora: '16501555000157', bandeira: '1', autorizacao: 'A9' }] } as any, emit, 0, 1);
assert.deepEqual((t.documento as any).pagamentos[0].cartao, { integracao: 1, cnpj: '16501555000157', bandeira: '01', autorizacao: 'A9' });
// PIX cobrado no banco (BMBancos): integrado, CNPJ do Banco do Brasil e o endToEndId como autorização, sem bandeira
const px = await montarDocumento({ ...venda, ajusteTotal: 0, pagamentos: [{ tPag: '17', valor: 39.99, intermediadorId: 6, integracao: 1, cnpjCredenciadora: '00000000000191', autorizacao: 'E00000000202611201200abcdef12345' }] } as any, emit, 0, 1);
assert.deepEqual((px.documento as any).pagamentos[0].cartao, { integracao: 1, cnpj: '00000000000191', autorizacao: 'E00000000202611201200abcdef12345' });
await assert.rejects(montarDocumento({ ...venda, ajusteTotal: 0, pagamentos: [{ tPag: '03', valor: 50, intermediadorId: 6 }] } as any, emit, 0, 1), /o troco só sai de pagamento em dinheiro/);
// Dinheiro (1,00) menor que o troco (11,01): recusado, igual ao DAV do erp-vendas
await assert.rejects(montarDocumento({ ...venda, pagamentos: [{ tPag: '01', valor: 1, intermediadorId: 5 }, { tPag: '03', valor: 49, intermediadorId: 6 }] } as any, emit, 0, 1), /dinheiro \(1\.00\) precisa ser maior/);
// Serviço: recusado no caixa
await assert.rejects(montarDocumento({ ...venda, itens: [{ produtoId: 4, quantidade: 1, valorUnitario: 5 }], ajusteTotal: 0 } as any, emit, 0, 1), /serviço não é vendido no caixa/);
// Grupo tributário sem CST do IBS/CBS e cClassTrib: recusado, apontando produto e grupo
await assert.rejects(montarDocumento({ ...venda, itens: [{ produtoId: 3, quantidade: 1, valorUnitario: 20 }], ajusteTotal: 0 } as any, emit, 0, 1), /Item 1 \(Café\): o grupo tributário "Revenda" não tem CST do IBS\/CBS/);
await assert.rejects(montarDocumento({ ...venda, pagamentos: [{ tPag: '01', valor: 50, intermediadorId: 0 }] } as any, emit, 0, 1), /intermediador/);
// Intermediador da transação (tipo T) não vale como intermediador do pagamento
await assert.rejects(montarDocumento({ ...venda, pagamentos: [{ tPag: '01', valor: 50, intermediadorId: 7 }] } as any, emit, 0, 1), /MARKETPLACE é intermediador da transação/);
// Troco de 1 centavo sem dinheiro também é recusado (38,99 pagos com 39,00 no cartão)
await assert.rejects(montarDocumento({ ...venda, pagamentos: [{ tPag: '03', valor: 39, intermediadorId: 6 }] } as any, emit, 0, 1), /o troco só sai de pagamento em dinheiro/);
// Validação antes do pagamento: sem pagamentos passa; o erro de cadastro aparece
assert.equal((await montarDocumento({ ...venda, pagamentos: [] } as any, emit, 0, 1, true)).modelo, '65');
await assert.rejects(montarDocumento({ ...venda, pagamentos: [], itens: [{ produtoId: 4, quantidade: 1, valorUnitario: 5 }], ajusteTotal: 0 } as any, emit, 0, 1, true), /serviço/);
await assert.rejects(montarDocumento({ ...venda, pagamentos: [] } as any, emit, 0, 1), /Informe o pagamento/);
// CPF com IE no cadastro: produtor primário, NF-e mesmo sem a IE digitada no caixa (como o modeloExigido do erp-vendas)
const produtor = await montarDocumento({ ...venda, consumidor: { documento: '11144477735' } } as any, emit, 0, 1);
assert.equal(produtor.modelo, '55');
assert.deepEqual([(produtor.documento as any).destinatario.indIEDest, (produtor.documento as any).destinatario.inscricaoEstadual], [1, '255123456']);

// R$ 200.000,00 (20.000 × 10,00) ou mais: NF-e (Anexo 11 art. 96 § 7º), com o cliente identificado e cadastrado
const grande = { ...venda, itens: [{ produtoId: 1, quantidade: 20000, valorUnitario: 10 }], ajusteTotal: 0, pagamentos: [{ tPag: '01', valor: 200000, intermediadorId: 5 }] };
await assert.rejects(montarDocumento({ ...grande, consumidor: {} } as any, emit, 0, 1), /a partir de R\$ 200\.000,00 sai em NF-e/);
await assert.rejects(montarDocumento(grande as any, emit, 0, 1), /CPF 52998224725 não cadastrado.*a partir de R\$ 200\.000,00/);
// Com o desconto, 200.000,00 − 0,01 fica em NFC-e
assert.equal((await montarDocumento({ ...grande, ajusteTotal: -0.01 } as any, emit, 0, 1)).modelo, '65');

// CEST só com substituição tributária: CSOSN 500 (Simples) e CST 60 (normal) exigem; CSOSN 102 não
assert.equal(comST({ csosn: '500' }, true), true);
assert.equal(comST({ csosn: '102', cst_icms: '60' }, true), false);
assert.equal(comST({ cst_icms: '60' }, false), true);
assert.equal(comST({ cst_icms: '00' }, false), false);

console.log('notas: ok');
process.exit(0);
