// Hora de Brasília, qualquer que seja o fuso do navegador ou do servidor (a Vercel roda em UTC).
// Nunca usar toISOString() para gravar no banco ou para "hoje": ele devolve UTC (3 horas adiantado).
// O Brasil não tem horário de verão desde 2019: o deslocamento é sempre -03:00.
const relogio = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** 'aaaa-mm-dd hh:mm:ss' no horário de Brasília (DATETIME do MySQL) */
export function dataHoraSql(d: Date = new Date()): string {
  const p = Object.fromEntries(relogio.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 'aaaa-mm-dd' no horário de Brasília (DATE do MySQL) */
export const dataSql = (d: Date = new Date()): string => dataHoraSql(d).slice(0, 10);

/** 'aaaa-mm-dd hh:mm:ss' (já em Brasília) → data/hora da SEFAZ: 'aaaa-mm-ddThh:mm:ss-03:00' */
export const dataHoraSefaz = (sql: string = dataHoraSql()): string => `${sql.slice(0, 19).replace(' ', 'T')}-03:00`;
