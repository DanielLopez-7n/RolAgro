// Pool de conexiones MySQL (mysql2/promise).
// Reutilizado por los controladores y por db/init.js.

require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "rolagro_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Solo hace falta si MySQL vive en otro host que exige TLS (un servicio
  // gestionado, por ejemplo). Con MySQL en el mismo VPS no aplica.
  ...(process.env.DB_SSL === "true"
    ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" } }
    : {}),
});

module.exports = pool;
