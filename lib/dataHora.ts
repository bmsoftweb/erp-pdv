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

/**
 * Prazo de transmissão da NFC-e de contingência (Anexo 11, art. 104, § 1º): o primeiro dia útil seguinte à emissão.
 * 'aaaa-mm-dd' → 'aaaa-mm-dd'. ponytail: só pula sábado e domingo; feriado conta como útil (perto de feriado o aviso de vencido sai um dia antes; cadastro de feriados se incomodar)
 */
export function prazoContingencia(emissao: string): string {
  const d = new Date(`${emissao.slice(0, 10)}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10); // data pura (meio-dia UTC), sem fuso
}
