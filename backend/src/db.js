
const mysql = require('mysql2/promise');
const fs = require('fs');

const ca = fs.readFileSync('/etc/secrets/ca.pem', 'utf8');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  ssl: {
    ca: ca,
    rejectUnauthorized: true
  },

  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  dateStrings: true,
  charset: 'utf8mb4'
});

module.exports = { pool };
