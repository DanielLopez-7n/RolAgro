const pool = require("../config/db");
const productsService = require("./products.service");
const AppError = require("../utils/AppError");
const { parseId } = require("../utils/validate");

/**
 * Servicio de lotes con fecha de vencimiento (`product_batches`).
 *
 * Un producto puede tener varios lotes activos a la vez (distintas compras,
 * distintas fechas). Se cargan a mano desde el panel o los trae la
 * importación del ERP (columnas "VENCIDOS Y PROXIMOS A VENCER"/"FECHA" del
 * export — ver inventoryImport.service.js).
 *
 * Los cálculos de urgencia (días restantes, nivel) son funciones puras sin
 * SQL, para poder probarlas sin base de datos: ver test/batches.service.test.js.
 */

const URGENCY_TIERS = {
  VENCIDO: "vencido",
  CRITICO: "critico",
  URGENTE: "urgente",
  PROXIMO: "proximo",
  CON_TIEMPO: "con_tiempo",
};

/**
 * Formatea una fecha (Date, o algo convertible) como "AAAA-MM-DD" usando sus
 * componentes UTC.
 *
 * mysql2 devuelve las columnas DATE como objetos Date a medianoche UTC, y
 * ExcelJS hace lo mismo al leer una fecha de una celda; tomar los
 * componentes locales acá correría el riesgo de un día de diferencia según
 * la zona horaria del proceso de Node. Por eso todo el módulo trabaja la
 * fecha de vencimiento como texto "AAAA-MM-DD", no como Date, salvo al
 * calcular los días restantes contra "hoy" (que sí es una fecha local: hoy
 * es hoy en la zona horaria de la tienda, no en UTC).
 */
function toDateOnlyString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw AppError.badRequest("La fecha de vencimiento no es válida.");
  }
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Días restantes hasta la fecha de vencimiento (negativo si ya venció).
 * `referenceDate` es "hoy": se toma en la zona horaria local del proceso
 * (es la fecha del calendario de la tienda, no un instante UTC), y se
 * comparan dos medianochas UTC para que el resultado sea un entero exacto
 * de días sin que la hora del día afecte el cálculo.
 */
function daysUntil(expirationDateStr, referenceDate = new Date()) {
  const [y, m, d] = expirationDateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  return Math.round((target - today) / 86400000);
}

/** Nivel de urgencia según los días restantes. Mismo criterio que el mockup original. */
function tierOf(days) {
  if (days < 0) return URGENCY_TIERS.VENCIDO;
  if (days <= 30) return URGENCY_TIERS.CRITICO;
  if (days <= 60) return URGENCY_TIERS.URGENTE;
  if (days <= 90) return URGENCY_TIERS.PROXIMO;
  return URGENCY_TIERS.CON_TIEMPO;
}

/**
 * Todos los lotes con su producto, marca y categoría, más los días
 * restantes y el nivel de urgencia ya calculados — lo que necesita
 * directamente el panel para el tablero de vencimientos.
 */
async function findAllWithStatus() {
  const [rows] = await pool.query(`
    SELECT b.id, b.product_id, b.qty, b.expiration_date, b.updated_at,
           p.name AS product_name, p.sku AS product_sku, p.image_url,
           c.name AS category_name, mk.name AS marca_name
    FROM product_batches b
    JOIN products p ON p.id = b.product_id
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN marcas mk ON mk.id = p.marca_id
    ORDER BY b.expiration_date ASC
  `);

  const today = new Date();
  return rows.map((row) => {
    const expirationDate = toDateOnlyString(row.expiration_date);
    const days = daysUntil(expirationDate, today);
    return {
      ...row,
      expiration_date: expirationDate,
      days,
      tier: tierOf(days),
    };
  });
}

/**
 * Crea o actualiza el lote de un producto para una fecha de vencimiento
 * dada: si ya existe un lote de ese producto con esa misma fecha, actualiza
 * la cantidad; si no, crea uno nuevo.
 *
 * Es el método que usa la importación del ERP: reimportar el mismo archivo
 * (o uno más nuevo con la misma fecha y una cantidad distinta, porque se
 * vendió parte del lote) actualiza en vez de duplicar filas.
 */
async function upsert({ productId, qty, expirationDate }) {
  const dateStr = toDateOnlyString(expirationDate);

  const [existing] = await pool.query(
    "SELECT id FROM product_batches WHERE product_id = ? AND expiration_date = ?",
    [productId, dateStr]
  );

  if (existing.length > 0) {
    await pool.query("UPDATE product_batches SET qty = ? WHERE id = ?", [qty, existing[0].id]);
    return { id: existing[0].id, created: false };
  }

  const [result] = await pool.query(
    "INSERT INTO product_batches (product_id, qty, expiration_date) VALUES (?, ?, ?)",
    [productId, qty, dateStr]
  );
  return { id: result.insertId, created: true };
}

/**
 * Alta manual de un lote desde el panel. Valida lo que llega del formulario
 * (a diferencia de `upsert`, que asume datos ya limpios porque los arma el
 * importador) y usa `upsert` para no duplicar si el administrador carga dos
 * veces el mismo producto con la misma fecha.
 */
async function create({ productId: rawProductId, qty: rawQty, expirationDate: rawDate }) {
  const productId = parseId(rawProductId, "producto");

  if (!(await productsService.exists(productId))) {
    throw AppError.badRequest("El producto elegido ya no existe.");
  }

  const qty = Number(rawQty);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw AppError.badRequest("La cantidad debe ser un número entero mayor a 0.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rawDate || ""))) {
    throw AppError.badRequest('La fecha de vencimiento debe tener el formato "AAAA-MM-DD".');
  }

  return upsert({ productId, qty, expirationDate: rawDate });
}

/** Elimina un lote (ej. cuando ya se vendió o se dio de baja todo el stock de esa fecha). */
async function remove(rawId) {
  const id = parseId(rawId, "identificador de lote");

  const [result] = await pool.query("DELETE FROM product_batches WHERE id = ?", [id]);
  if (result.affectedRows === 0) {
    throw AppError.notFound("El lote no existe.");
  }
}

module.exports = {
  URGENCY_TIERS,
  toDateOnlyString,
  daysUntil,
  tierOf,
  findAllWithStatus,
  upsert,
  create,
  remove,
};
