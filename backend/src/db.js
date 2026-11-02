
const mysql = require('mysql2/promise');
const fs = require('fs');

let sslCa;

if (process.env.DB_SSL_CA_PATH) {
  sslCa = fs.readFileSync(process.env.DB_SSL_CA_PATH, 'utf8');
} else if (process.env.DB_SSL_CA) {
  sslCa = process.env.DB_SSL_CA.replace(/\\n/g, '\n');
}

if (!sslCa) {
  throw new Error('Aiven SSL certificate is missing');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  ssl: {
    ca: sslCa,
    rejectUnauthorized: true
  },

  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  dateStrings: true,
  charset: 'utf8mb4'
});

module.exports = { pool };
