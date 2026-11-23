/** Conferência do clube de descontos. Rode com: npx tsx --env-file=.env lib/clube.check.ts */
import assert from 'node:assert/strict';
import { precoNaVenda } from './clube';
import { precoDoClube } from '../server/clube';
import type { ListaPreco } from './precos';

const lista = (id: number, extra: Partial<ListaPreco>): ListaPreco => ({ id, nome: `L${id}`, prioridade: 0, ativo: true, criterios: { clube: ['1'] }, itens: [], ...extra });

// Banana (produto 80, categoria 18) R$ 6,99: lista com -10% na categoria → 6,291 → 6,29, até 30/11
const hortifruti = lista(1, { vigenciaFim: '2026-11-30', itens: [{ escopo: 'categoria', escopoId: 18, tipo: 'percentual', valor: -10 }] });
const banana = { id: 80, preco_venda: '6.99', categoria_id: 18 };
assert.deepEqual(precoDoClube([hortifruti], '2026-11-22', banana), { preco: 6.29, ate: '2026-11-30' });
// Preço fixo do produto vence a categoria na mesma lista; lista sem fim vale "para sempre"
const fixa = lista(2, { prioridade: -1, itens: [{ escopo: 'produto', escopoId: 80, tipo: 'preco', valor: 5.99 }] });
assert.deepEqual(precoDoClube([hortifruti, fixa], '2026-11-22', banana), { preco: 5.99, ate: '9999-12-31' });
// Fora da vigência, lista que aumenta o preço ou só por quantidade (o caixa manda 1): sem desconto
assert.equal(precoDoClube([hortifruti], '2026-12-01', banana), null);
assert.equal(precoDoClube([lista(3, { ajustePercentual: 5 })], '2026-11-22', banana), null);
assert.equal(precoDoClube([lista(4, { qtdMin: 10, ajustePercentual: -20 })], '2026-11-22', banana), null);
// Lista que também exige cidade: o PDV não manda cidade, não vale
assert.equal(precoDoClube([lista(5, { criterios: { clube: ['1'], cidade: ['10'] }, ajustePercentual: -20 })], '2026-11-22', banana), null);

const sinc = { preco_venda: '6.99', preco_clube: 6.29, clube_ate: '2026-11-30' };
assert.equal(precoNaVenda(sinc, true, '2026-11-22'), 6.29);
assert.equal(precoNaVenda(sinc, true, '2026-11-30'), 6.29);
assert.equal(precoNaVenda(sinc, true, '2026-12-01'), 6.99); // lista acabou
assert.equal(precoNaVenda(sinc, false, '2026-11-22'), 6.99); // não é associado
assert.equal(precoNaVenda({ preco_venda: 5 }, true, '2026-11-22'), 5); // produto fora do clube

console.log('clube: ok');
process.exit(0);
