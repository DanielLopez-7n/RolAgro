const pool = require("../config/db");
const categoriesService = require("./categories.service");
const AppError = require("../utils/AppError");
const { parseId } = require("../utils/validate");

/**
 * Servicio de productos: único lugar del proyecto que consulta la tabla
 * `products`. Las validaciones viven aquí y no en el controlador para que la
 * regla sea la misma venga la petición de donde venga (panel, API pública o
 * un script de carga masiva a futuro).
 */

const MAX_PRICE = 99999999.99; // Tope de DECIMAL(10,2) en la tabla.

const SELECT_WITH_CATEGORY = `
  SELECT p.id, p.name, p.description, p.price, p.image_url,
         p.category_id, c.name AS category_name
  FROM products p
  JOIN categories c ON c.id = p.category_id
`;

/**
 * Valida y normaliza los datos de un producto que llegan del panel.
 * Devuelve el objeto listo para SQL o lanza AppError con el motivo.
 */
async function validate({ name, description, price, categoryId, imageUrl }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    throw AppError.badRequest("El nombre del producto es requerido.");
  }
  if (cleanName.length > 150) {
    throw AppError.badRequest("El nombre no puede superar los 150 caracteres.");
  }

  const cleanDescription = String(description || "").trim();
  if (cleanDescription.length > 2000) {
    throw AppError.badRequest("La descripción no puede superar los 2000 caracteres.");
  }

  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) {
    throw AppError.badRequest("El precio debe ser un número mayor o igual a 0.");
  }
  if (numericPrice > MAX_PRICE) {
    throw AppError.badRequest("El precio es demasiado alto.");
  }

  const cleanImageUrl = String(imageUrl || "").trim();
  if (cleanImageUrl.length > 255) {
    throw AppError.badRequest("La URL de la imagen no puede superar los 255 caracteres.");
  }
  // Se aceptan enlaces externos y rutas propias (/images/...), pero no
  // esquemas como javascript: que acabarían dentro de un atributo del catálogo.
  if (cleanImageUrl && !/^(https?:\/\/|\/)/.test(cleanImageUrl)) {
    throw AppError.badRequest(
      'La URL de la imagen debe empezar por "http://", "https://" o "/".'
    );
  }

  const numericCategoryId = parseId(categoryId, "categoría");
  if (!(await categoriesService.exists(numericCategoryId))) {
    throw AppError.badRequest("La categoría elegida ya no existe.");
  }

  return {
    name: cleanName,
    description: cleanDescription || null,
    price: numericPrice,
    categoryId: numericCategoryId,
    imageUrl: cleanImageUrl || null,
  };
}

/**
 * Catálogo público, opcionalmente filtrado por categoría.
 * El filtro se valida antes de llegar a la consulta: si viene basura, se
 * devuelve el catálogo completo en vez de fallar (es un parámetro opcional
 * de una vista pública, no una operación crítica).
 */
async function findAll({ categoryId } = {}) {
  let sql = SELECT_WITH_CATEGORY;
  const params = [];

  const numericCategoryId = Number(categoryId);
  if (categoryId && Number.isInteger(numericCategoryId) && numericCategoryId > 0) {
    sql += " WHERE p.category_id = ?";
    params.push(numericCategoryId);
  }

  sql += " ORDER BY p.id";

  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Listado para el panel: los más recientes primero. */
async function findAllForAdmin() {
  const [rows] = await pool.query(`${SELECT_WITH_CATEGORY} ORDER BY p.id DESC`);
  return rows;
}

/**
 * Busca varios productos por id y los devuelve indexados en un Map.
 * Lo usa el servicio de pedidos para recalcular precios contra la base: los
 * ids se validan uno a uno para que nunca entre un valor no numérico en la
 * cláusula IN.
 */
async function findByIds(ids) {
  const cleanIds = [...new Set(ids.map((id) => parseId(id, "producto")))];

  const placeholders = cleanIds.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT id, name, price FROM products WHERE id IN (${placeholders})`,
    cleanIds
  );

  return new Map(rows.map((product) => [product.id, product]));
}

/** Crea un producto y devuelve su id. */
async function create(input) {
  const data = await validate(input);

  const [result] = await pool.query(
    `INSERT INTO products (category_id, name, description, price, image_url)
     VALUES (?, ?, ?, ?, ?)`,
    [data.categoryId, data.name, data.description, data.price, data.imageUrl]
  );

  return { id: result.insertId };
}

/** Actualiza un producto existente. Lanza 404 si el id no existe. */
async function update(rawId, input) {
  const id = parseId(rawId, "identificador de producto");
  const data = await validate(input);

  const [result] = await pool.query(
    `UPDATE products
       SET category_id = ?, name = ?, description = ?, price = ?, image_url = ?
     WHERE id = ?`,
    [data.categoryId, data.name, data.description, data.price, data.imageUrl, id]
  );

  if (result.affectedRows === 0) {
    throw AppError.notFound("El producto no existe.");
  }
}

/**
 * Elimina un producto.
 * Los pedidos que lo incluyan conservan su propio nombre y precio: el FK de
 * order_items queda en NULL (ver data/schema.sql).
 */
async function remove(rawId) {
  const id = parseId(rawId, "identificador de producto");

  const [result] = await pool.query("DELETE FROM products WHERE id = ?", [id]);

  if (result.affectedRows === 0) {
    throw AppError.notFound("El producto no existe.");
  }
}

module.exports = {
  findAll,
  findAllForAdmin,
  findByIds,
  create,
  update,
  remove,
};
