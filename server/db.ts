import mysql from 'mysql2/promise';

// Mesmo banco do ERP BMsoft usado pelos outros módulos (bmerp_000000). Credenciais só pelo .env.
for (const nome of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD']) {
  if (!process.env[nome]) throw new Error(`${nome} não definido no .env.`);
}

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'bmerp_000000',
  // DATE volta como 'aaaa-mm-dd' (sem passar por Date/UTC); DATETIME continua Date
  dateStrings: ['DATE'],
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 20000,
  enableKeepAlive: true,
  // O MySQL derruba conexão parada (ECONNRESET): fecha as ociosas antes de serem reaproveitadas
  maxIdle: 0,
  idleTimeout: 20000,
});

// O sistema opera no horário de Brasília (UTC-3), qualquer que seja o fuso do servidor MySQL
pool.pool.on('connection', (conn: any) => {
  conn.query("SET time_zone = '-03:00'");
});
