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

/**
 * Avisa si la base ya existía y le faltan las tablas/columnas agregadas
 * después de su creación.
 *
 * schema.sql usa CREATE TABLE IF NOT EXISTS, así que sobre una base vieja
 * este script no falla: simplemente no hace nada, y la app arranca bien
 * pero revienta en la primera consulta con "Unknown column 'p.published'".
 * Ese error no dice en ningún lado que lo que falta es correr la migración,
 * así que se detecta acá.
 */
async function warnIfMigrationPending(connection, dbName) {
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products'`,
    [dbName]
  );
  const [tables] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('marcas', 'product_batches')`,
    [dbName]
  );

  const columnNames = new Set(columns.map((c) => c.COLUMN_NAME));
  const tableNames = new Set(tables.map((t) => t.TABLE_NAME));

  const missing = [
    ...["sku", "marca_id", "published"]
      .filter((name) => !columnNames.has(name))
      .map((name) => `products.${name}`),
    ...["marcas", "product_batches"].filter((name) => !tableNames.has(name)),
  ];

  if (missing.length === 0) return;

  console.warn(
    `\n⚠️  La base "${dbName}" ya existía y le falta: ${missing.join(", ")}.\n` +
      "   schema.sql solo crea tablas nuevas, no modifica una tabla que ya existe,\n" +
      "   así que hay que correr la migración una vez:\n\n" +
      `     mysql -u USUARIO -p ${dbName} < data/migrations/2026-09-09_marcas_y_sku.sql\n\n` +
      "   Sin eso, el panel va a fallar con errores del tipo \"Unknown column\".\n"
  );
}

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

    await warnIfMigrationPending(connection, DB_NAME);

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
