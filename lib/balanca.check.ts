/** Conferência da leitura da resposta da balança. Rode com: npx tsx lib/balanca.check.ts */
import assert from 'node:assert/strict';
import { interpretar } from './balanca';

const b = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
assert.equal(interpretar(b('\x0201250\x03')), 1.25); // Toledo/Filizola: 5 dígitos, 3 casas
assert.equal(interpretar(b('\x0200085\x03')), 0.085);
assert.equal(interpretar(b('1.250\r\n')), 1.25); // sem STX/ETX, com ponto
assert.equal(interpretar(b('\x02IIIII\x03')), 'instavel');
assert.throws(() => interpretar(b('\x02NNNNN\x03')), /negativo/);
assert.throws(() => interpretar(b('\x02SSSSS\x03')), /capacidade/);
assert.throws(() => interpretar(b('\x02\x03')), /não reconhecida/);
console.log('balança ok');
