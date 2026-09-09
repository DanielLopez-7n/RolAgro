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
  // Las columnas DATE se leen como texto "AAAA-MM-DD", no como Date.
  //
  // Por defecto mysql2 convierte un DATE a un Date de JavaScript ubicado en
  // la MEDIANOCHE LOCAL del proceso. En un servidor con huso positivo
  // (ej. Europa, UTC+2) esa medianoche cae el día anterior en UTC, así que
  // leer sus componentes UTC devolvía un día menos: un lote que vence el 15
  // se mostraba venciendo el 14. Una fecha de vencimiento no tiene hora ni
  // zona horaria —es un día del calendario— y como texto no hay nada que
  // interpretar mal. Ver batches.service.js (toDateOnlyString).
  dateStrings: ["DATE"],
  // Solo hace falta si MySQL vive en otro host que exige TLS (un servicio
  // gestionado, por ejemplo). Con MySQL en el mismo VPS no aplica.
  ...(process.env.DB_SSL === "true"
    ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" } }
    : {}),
});

module.exports = pool;
