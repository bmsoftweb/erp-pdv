/** Conferência das regras fiscais do PDV. Rode com: npx tsx lib/fiscal.check.ts */
import assert from 'node:assert/strict';
import { cnpjValido, cpfValido, modeloDoDocumento, ratear, totalDoItem } from './fiscal';

assert.ok(cpfValido('529.982.247-25'));
assert.ok(!cpfValido('529.982.247-24'));
assert.ok(!cpfValido('111.111.111-11'));
assert.ok(cnpjValido('08.511.951/0001-37'));
assert.ok(!cnpjValido('08.511.951/0001-38'));

// Requisito IV: sem identificação ou CPF → 65; CNPJ ou CPF + IE de produtor → 55
assert.equal(modeloDoDocumento(''), '65');
assert.equal(modeloDoDocumento('52998224725'), '65');
assert.equal(modeloDoDocumento('08511951000137'), '55');
assert.equal(modeloDoDocumento('52998224725', '123456789'), '55');

// IAT: 3 × 3,333 = 9,999 → A arredonda para 10,00; T trunca para 9,99
assert.equal(totalDoItem(3, 3.333, 'A'), 10);
assert.equal(totalDoItem(3, 3.333, 'T'), 9.99);
// 1,005 kg × 10,00 = 10,05 exatos nos dois
assert.equal(totalDoItem(1.005, 10, 'T'), 10.05);

// Rateio de desconto de 1,00 em itens de 10 e 20: 0,33 + 0,67
assert.deepEqual(ratear(1, [10, 20]), [0.33, 0.67]);

console.log('fiscal: ok');
