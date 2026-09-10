const pool = require("../config/db");
const categoriesService = require("./categories.service");
const marcasService = require("./marcas.service");
const AppError = require("../utils/AppError");
const { parseId } = require("../utils/validate");

/**
 * Servicio de productos: único lugar del proyecto que consulta la tabla
 * `products`. Las validaciones viven aquí y no en el controlador para que la
 * regla sea la misma venga la petición de donde venga (panel, API pública o
 * un script de carga masiva a futuro).
 */

const MAX_PRICE = 99999999.99; // Tope de DECIMAL(10,2) en la tabla.
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200; // Tope para que ?pageSize= no se use para traer el catálogo entero de un tirón.
const SEARCH_RESULT_LIMIT = 20;

// LEFT JOIN a marcas porque marca_id es opcional (ver data/schema.sql): un
// producto sin marca comercial (ej. un fertilizante genérico) sigue
// apareciendo en el catálogo, solo que sin ese dato. Separado de
// SELECT_WITH_CATEGORY para reutilizarlo también en el listado paginado del
// panel, que necesita una columna más (el conteo total) sin duplicar el JOIN.
const PRODUCTS_FROM_JOIN = `
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN marcas mk ON mk.id = p.marca_id
`;

const SELECT_WITH_CATEGORY = `
  SELECT p.id, p.name, p.description, p.price, p.image_url, p.published,
         p.category_id, c.name AS category_name,
         p.marca_id, mk.name AS marca_name
  ${PRODUCTS_FROM_JOIN}
`;

/**
 * Normaliza la marca elegida en el panel a un id o a `null`.
 *
 * La marca es opcional, a diferencia de la categoría: el `<select>` del modal
 * tiene una opción "Sin marca" que llega como cadena vacía, y un producto
 * genérico (un fertilizante sin marca comercial, ver data/schema.sql) se queda
 * así para siempre. "Vacío" y "un id que no sirve" son casos distintos: el
 * primero es una elección válida y el segundo un error, así que este helper
 * traduce el primero a null y deja que parseId rechace el segundo.
 *
 * Separado de la consulta —igual que resolvePagination— porque es la parte con
 * casos borde y se puede probar sin base de datos.
 */
function normalizeMarcaId(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  return parseId(value, "marca");
}

/**
 * Valida y normaliza los datos de un producto que llegan del panel.
 * Devuelve el objeto listo para SQL o lanza AppError con el motivo.
 */
async function validate({ name, description, price, categoryId, marcaId, imageUrl }) {
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

  // Se comprueba acá y no se deja reventar el FK de products.marca_id: un
  // ER_NO_REFERENCED_ROW sale como error 500 y el panel muestra "algo salió
  // mal", cuando en realidad el dato de entrada es corregible por quien lo
  // envió (la marca se borró desde otra pestaña mientras el modal estaba
  // abierto). Mismo criterio que la categoría, unas líneas más arriba.
  const numericMarcaId = normalizeMarcaId(marcaId);
  if (numericMarcaId !== null && !(await marcasService.exists(numericMarcaId))) {
    throw AppError.badRequest("La marca elegida ya no existe.");
  }

  return {
    name: cleanName,
    description: cleanDescription || null,
    price: numericPrice,
    categoryId: numericCategoryId,
    marcaId: numericMarcaId,
    imageUrl: cleanImageUrl || null,
  };
}

/**
 * Catálogo público, opcionalmente filtrado por categoría.
 * El filtro se valida antes de llegar a la consulta: si viene basura, se
 * devuelve el catálogo completo en vez de fallar (es un parámetro opcional
 * de una vista pública, no una operación crítica).
 *
 * Solo trae productos con published = 1: los que crea la importación del
 * ERP nacen sin publicar (ver createFromImport) porque no tienen un precio
 * real todavía, y no deben verse en el sitio hasta que alguien los revise
 * desde el panel.
 */
async function findAll({ categoryId } = {}) {
  let sql = `${SELECT_WITH_CATEGORY} WHERE p.published = 1`;
  const params = [];

  const numericCategoryId = Number(categoryId);
  if (categoryId && Number.isInteger(numericCategoryId) && numericCategoryId > 0) {
    sql += " AND p.category_id = ?";
    params.push(numericCategoryId);
  }

  sql += " ORDER BY p.id";

  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Normaliza page/pageSize a enteros válidos y calcula el OFFSET.
 *
 * Separado de findAllForAdmin (sin SQL, sin pool) para poder probarlo sin
 * base de datos: es la parte que decide qué pasa si llega un ?page=-3,
 * ?page=abc o un ?pageSize=999999 tratando de traer el catálogo entero de
 * un tirón — no la consulta en sí.
 */
function resolvePagination({ page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  // Chequeo explícito (Number.isInteger + >= 1) en vez de "|| valorPorDefecto":
  // con ese atajo, un número negativo o cero es "verdadero" para el operador
  // ||, así que se cuela sin caer en el default — solo NaN/texto lo hacían.
  const numericPage = Math.floor(Number(page));
  const cleanPage = Number.isInteger(numericPage) && numericPage >= 1 ? numericPage : 1;

  const numericPageSize = Math.floor(Number(pageSize));
  const cleanPageSize =
    Number.isInteger(numericPageSize) && numericPageSize >= 1
      ? Math.min(numericPageSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return {
    page: cleanPage,
    pageSize: cleanPageSize,
    offset: (cleanPage - 1) * cleanPageSize,
  };
}

/**
 * Listado paginado para el panel, con búsqueda por nombre/sku y filtro por
 * estado de publicación (`published`: true, false, o sin definir = todos).
 *
 * Sin esto, una importación del ERP que deja miles de productos borrador de
 * una sola vez (ver inventoryImport.service.js) haría que el panel intente
 * traer y dibujar el catálogo entero en una sola tabla.
 *
 * `COUNT(*) OVER()` trae el total de filas que cumplen el filtro junto con
 * la página pedida, en una sola consulta — evita un SELECT COUNT(*) aparte
 * solo para saber cuántas páginas hay.
 */
async function findAllForAdmin({ page, pageSize, search, published } = {}) {
  const { page: cleanPage, pageSize: cleanPageSize, offset } = resolvePagination({ page, pageSize });

  const conditions = [];
  const params = [];

  if (published === true || published === "true") {
    conditions.push("p.published = 1");
  } else if (published === false || published === "false") {
    conditions.push("p.published = 0");
  }

  const cleanSearch = String(search || "").trim();
  if (cleanSearch) {
    conditions.push("(p.name LIKE ? OR p.sku LIKE ?)");
    const like = `%${cleanSearch}%`;
    params.push(like, like);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.description, p.price, p.image_url, p.published,
            p.category_id, c.name AS category_name,
            p.marca_id, mk.name AS marca_name,
            COUNT(*) OVER() AS total_count
     ${PRODUCTS_FROM_JOIN}
     ${whereSql}
     ORDER BY p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, cleanPageSize, offset]
  );

  const total = rows.length > 0 ? rows[0].total_count : 0;
  const items = rows.map(({ total_count, ...item }) => item);

  return {
    items,
    total,
    page: cleanPage,
    pageSize: cleanPageSize,
    totalPages: Math.max(1, Math.ceil(total / cleanPageSize)),
  };
}

/** Un producto por id, con su categoría y marca. Null si no existe. */
async function findById(rawId) {
  const id = parseId(rawId, "identificador de producto");
  const [rows] = await pool.query(`${SELECT_WITH_CATEGORY} WHERE p.id = ?`, [id]);
  return rows[0] || null;
}

/**
 * Búsqueda liviana por nombre o sku, para el selector de producto del modal
 * "Nuevo lote" del panel. A propósito no usa `findAllForAdmin`: ese trae
 * columnas de más (categoría, marca) que acá no hacen falta, y esto se
 * llama en cada tecla que escribe el administrador.
 */
async function search(rawQuery, limit = SEARCH_RESULT_LIMIT) {
  const query = String(rawQuery || "").trim();
  if (!query) return [];

  const cleanLimit = Math.min(50, Math.max(1, Math.floor(Number(limit)) || SEARCH_RESULT_LIMIT));
  const like = `%${query}%`;

  const [rows] = await pool.query(
    `SELECT id, name, sku, published FROM products
     WHERE name LIKE ? OR sku LIKE ?
     ORDER BY name
     LIMIT ?`,
    [like, like, cleanLimit]
  );
  return rows;
}

/**
 * Busca varios productos por id y los devuelve indexados en un Map.
 * Lo usa el servicio de pedidos para recalcular precios contra la base: los
 * ids se validan uno a uno para que nunca entre un valor no numérico en la
 * cláusula IN.
 *
 * Excluye los productos sin publicar: un borrador creado por la importación
 * (precio $0, sin revisar) no debe poder comprarse aunque alguien conozca o
 * adivine su id. Para el checkout, un producto sin publicar es como si no
 * existiera (mismo caso que RF15: "producto que ya no existe").
 */
async function findByIds(ids) {
  const cleanIds = [...new Set(ids.map((id) => parseId(id, "producto")))];

  const placeholders = cleanIds.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT id, name, price FROM products WHERE id IN (${placeholders}) AND published = 1`,
    cleanIds
  );

  return new Map(rows.map((product) => [product.id, product]));
}

/** Comprueba si un producto existe. Lo usa el alta manual de lotes. */
async function exists(id) {
  const [rows] = await pool.query("SELECT id FROM products WHERE id = ?", [id]);
  return rows.length > 0;
}

/**
 * Busca un producto por su código de referencia del ERP (sku).
 * Lo usa la importación de inventario (inventoryImport.service.js) para
 * emparejar cada fila del Excel con su producto, en vez de emparejar por
 * nombre, que es frágil ante renombres o diferencias de tipeo.
 */
async function findBySku(sku) {
  const [rows] = await pool.query(
    "SELECT id, name, marca_id FROM products WHERE sku = ?",
    [sku]
  );
  return rows[0] || null;
}

/**
 * Actualiza únicamente la marca de un producto ya emparejado por sku.
 * Deliberadamente angosto: el archivo del ERP solo trae REFERENCIA, DETALLE,
 * MARCA y CANTIDAD — no precio ni categoría — así que la importación no debe
 * tocar nada más del producto.
 */
async function updateMarca(id, marcaId) {
  await pool.query("UPDATE products SET marca_id = ? WHERE id = ?", [marcaId, id]);
}

/**
 * Crea un producto "borrador" a partir de una fila de la importación del
 * ERP: nace sin publicar y con precio $0, porque el archivo no trae precio
 * ni categoría reales (ver findAll). No pasa por `validate()` — ese
 * validador exige un precio real y una categoría elegida a mano, que acá
 * todavía no existen — así que este camino queda separado a propósito del
 * alta manual del panel (`create`), aunque escriban en la misma tabla.
 */
async function createFromImport({ sku, name, marcaId, categoryId }) {
  const [result] = await pool.query(
    `INSERT INTO products (category_id, marca_id, sku, name, price, published)
     VALUES (?, ?, ?, ?, 0, 0)`,
    [categoryId, marcaId, sku, name]
  );
  return { id: result.insertId };
}

/**
 * Publica o despublica un producto (ej. un borrador de la importación, una
 * vez que el administrador le cargó un precio real). Lanza 404 si el id no
 * existe.
 */
async function setPublished(rawId, published) {
  const id = parseId(rawId, "identificador de producto");

  const [result] = await pool.query("UPDATE products SET published = ? WHERE id = ?", [
    published ? 1 : 0,
    id,
  ]);

  if (result.affectedRows === 0) {
    throw AppError.notFound("El producto no existe.");
  }
}

/** Crea un producto y devuelve su id. */
async function create(input) {
  const data = await validate(input);

  const [result] = await pool.query(
    `INSERT INTO products (category_id, marca_id, name, description, price, image_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [data.categoryId, data.marcaId, data.name, data.description, data.price, data.imageUrl]
  );

  return { id: result.insertId };
}

/**
 * Actualiza un producto existente. Lanza 404 si el id no existe.
 *
 * `marca_id` entra en el SET, así que guardar el formulario con "Sin marca"
 * elegida la deja en NULL: el modal muestra la marca actual, y lo que el
 * administrador ve ahí es lo que queda guardado. Es a propósito distinto de
 * updateMarca(), el camino de la importación, que nunca borra una marca ya
 * cargada porque el Excel puede traer la columna vacía sin querer decir nada.
 */
async function update(rawId, input) {
  const id = parseId(rawId, "identificador de producto");
  const data = await validate(input);

  const [result] = await pool.query(
    `UPDATE products
       SET category_id = ?, marca_id = ?, name = ?, description = ?, price = ?, image_url = ?
     WHERE id = ?`,
    [data.categoryId, data.marcaId, data.name, data.description, data.price, data.imageUrl, id]
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
  resolvePagination,
  normalizeMarcaId,
  findById,
  search,
  findByIds,
  exists,
  findBySku,
  updateMarca,
  createFromImport,
  setPublished,
  create,
  update,
  remove,
};
