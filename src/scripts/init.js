/**
 * RolAgro — inicializador de base de datos.
 * Crea la base (si no existe), aplica schema.sql y siembra seed.sql
 * (solo si la tabla `products` está vacía, para no duplicar datos en
 * ejecuciones repetidas).
 *
 * Uso: npm run db:init
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const {
  DB_HOST = "localhost",
  DB_PORT = 3306,
  DB_USER = "root",
  DB_PASSWORD = "",
  DB_NAME = "rolagro_db",
} = process.env;

async function run() {
  // 1) Conexión sin base de datos específica, para poder crearla si falta.
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  });

  try {
    console.log(`Creando base de datos "${DB_NAME}" (si no existe)...`);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4`
    );
    await connection.changeUser({ database: DB_NAME });

    const schemaSql = fs.readFileSync(
      path.join(__dirname, "../../data/schema.sql"),
      "utf8"
    );
    console.log("Aplicando schema.sql...");
    await connection.query(schemaSql);

    const [[{ total }]] = await connection.query(
      "SELECT COUNT(*) AS total FROM products"
    );

    if (total > 0) {
      console.log(
        `La tabla "products" ya tiene ${total} registro(s); se omite el seed.`
      );
    } else {
      const seedSql = fs.readFileSync(
        path.join(__dirname, "../../data/seed.sql"),
        "utf8"
      );
      console.log("Sembrando datos de ejemplo (seed.sql)...");
      await connection.query(seedSql);
      console.log("Seed aplicado correctamente.");
    }

    console.log("✅ Base de datos RolAgro lista.");
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error("❌ Error al inicializar la base de datos:", err.message);
  process.exit(1);
});
