/** Conferência das regras fiscais do PDV. Rode com: npx tsx lib/fiscal.check.ts */
import assert from 'node:assert/strict';
import { cnpjValido, cpfValido, gtinPublico, limiteCancelamento, modeloDoDocumento, ratear, totalDoItem } from './fiscal';

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
// Art. 106: NFC-e autorizada às 10:00:00 (Brasília) cancela até 10:30:00; NF-e e sem protocolo: sem prazo aqui
const limite = limiteCancelamento('65', '2026-11-21T10:00:00-03:00');
assert.equal(limite, Date.parse('2026-11-21T13:30:00Z'));
assert.equal(limiteCancelamento('55', '2026-11-21T10:00:00-03:00'), null);
assert.equal(limiteCancelamento('65', null), null);
assert.equal(limiteCancelamento('65', 'lixo'), null);
// Art. 96, § 7º: a partir de R$ 200.000,00 → 55
assert.equal(modeloDoDocumento('52998224725', '', 199999.99), '65');
assert.equal(modeloDoDocumento('52998224725', '', 200000), '55');
assert.equal(modeloDoDocumento('', '', 200000), '55');

// IAT: 3 × 3,333 = 9,999 → A arredonda para 10,00; T trunca para 9,99
assert.equal(totalDoItem(3, 3.333, 'A'), 10);
assert.equal(totalDoItem(3, 3.333, 'T'), 9.99);
// 1,005 kg × 10,00 = 10,05 exatos nos dois
assert.equal(totalDoItem(1.005, 10, 'T'), 10.05);

// Rateio de desconto de 1,00 em itens de 10 e 20: 0,33 + 0,67
assert.deepEqual(ratear(1, [10, 20]), [0.33, 0.67]);

console.log('fiscal: ok');

// GTIN na nota (Anexo 11, art. 99, § 1º): só o público e com dígito certo; o interno vai como SEM GTIN
assert.equal(gtinPublico('7891000315507'), '7891000315507'); // GTIN-13 brasileiro
assert.equal(gtinPublico('7891000315508'), null); // dígito errado
assert.equal(gtinPublico('2990000000361'), null); // código interno (prefixo 2xx)
assert.equal(gtinPublico('0412345678903'), null); // circulação restrita 04x (dígito certo)
assert.equal(gtinPublico('036000291452'), '036000291452'); // GTIN-12 (UPC) comum
assert.equal(gtinPublico('212345678909'), null); // UPC de peso variável (número 2, dígito certo)
assert.equal(gtinPublico('96385074'), '96385074'); // GTIN-8
assert.equal(gtinPublico('20123451'), null); // GTIN-8 restrito
assert.equal(gtinPublico('17891000315504'), '17891000315504'); // GTIN-14 (caixa)
assert.equal(gtinPublico('12345'), null);
assert.equal(gtinPublico(''), null);
