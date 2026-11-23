// Conferência do lib/dataHora.ts: npx tsx lib/dataHora.check.ts (sai com erro se algo quebrar)
import assert from 'node:assert/strict';
import { dataHoraSql, dataSql, dataHoraSefaz, prazoContingencia } from './dataHora';

// 21/11/2026 02:33 UTC = 20/11/2026 23:33 em Brasília: a venda das 23h33 é do dia 20, não do 21
const noite = new Date(Date.UTC(2026, 10, 21, 2, 33, 0));
assert.equal(dataHoraSql(noite), '2026-11-20 23:33:00');
assert.equal(dataSql(noite), '2026-11-20');
assert.equal(dataHoraSefaz(dataHoraSql(noite)), '2026-11-20T23:33:00-03:00');

// Meia-noite em ponto sai 00, não 24
assert.equal(dataHoraSql(new Date(Date.UTC(2026, 10, 20, 3, 0, 0))), '2026-11-20 00:00:00');

// Prazo da contingência: dia útil seguinte (sexta → segunda; sábado → segunda; quarta → quinta)
assert.equal(prazoContingencia('2026-11-20'), '2026-11-23');
assert.equal(prazoContingencia('2026-11-21 10:00:00'), '2026-11-23');
assert.equal(prazoContingencia('2026-11-25'), '2026-11-26');
assert.equal(prazoContingencia('2026-12-31'), '2027-01-01');

console.log('dataHora ok');
