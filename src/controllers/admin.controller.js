const pool = require("../config/db");

/**
 * Controlador del panel de administración.
 * Todas estas rutas van detrás de basicAuth (ver src/routes/admin.routes.js),
 * pero igual se valida cada campo: una sesión autenticada puede equivocarse
 * y no se debe confiar en el formulario del navegador.
 */

// MySQL avisa con este código cuando otra tabla todavía apunta a la fila
// que se intenta borrar (ej.: una categoría con productos dentro).
const FK_IN_USE = "ER_ROW_IS_REFERENCED_2";

/**
 * Valida y normaliza el cuerpo de un producto.
 * Devuelve { error } con el mensaje para el cliente, o { data } listo para SQL.
 */
async function parseProductBody(body) {
  const { name, description, price, category_id: categoryId, image_url: imageUrl } =
    body || {};

  const cleanName = String(name || "").trim();
  if (!cleanName) return { error: "El nombre del producto es requerido." };
  if (cleanName.length > 150) {
    return { error: "El nombre no puede superar los 150 caracteres." };
  }

  const cleanDescription = String(description || "").trim();
  if (cleanDescription.length > 2000) {
    return { error: "La descripción no puede superar los 2000 caracteres." };
  }

  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) {
    return { error: "El precio debe ser un número mayor o igual a 0." };
  }
  if (numericPrice > 99999999.99) {
    return { error: "El precio es demasiado alto." };
  }

  const cleanImageUrl = String(imageUrl || "").trim();
  if (cleanImageUrl.length > 255) {
    return { error: "La URL de la imagen no puede superar los 255 caracteres." };
  }
  // Se aceptan enlaces externos y rutas propias (/images/...), pero no
  // esquemas como javascript: que acabarían dentro de un atributo del catálogo.
  if (cleanImageUrl && !/^(https?:\/\/|\/)/.test(cleanImageUrl)) {
    return {
      error: 'La URL de la imagen debe empezar por "http://", "https://" o "/".',
    };
  }

  const numericCategoryId = Number(categoryId);
  if (!Number.isInteger(numericCategoryId) || numericCategoryId <= 0) {
    return { error: "Debes elegir una categoría." };
  }
  const [categories] = await pool.query("SELECT id FROM categories WHERE id = ?", [
    numericCategoryId,
  ]);
  if (categories.length === 0) {
    return { error: "La categoría elegida ya no existe." };
  }

  return {
    data: {
      name: cleanName,
      description: cleanDescription || null,
      price: numericPrice,
      categoryId: numericCategoryId,
      imageUrl: cleanImageUrl || null,
    },
  };
}

// GET /api/admin/products
async function listProducts(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT p.id, p.name, p.description, p.price, p.image_url,
             p.category_id, c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      ORDER BY p.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("Error al listar productos (admin):", err);
    res.status(500).json({ error: "No se pudieron obtener los productos." });
  }
}

// POST /api/admin/products
async function createProduct(req, res) {
  try {
    const { error, data } = await parseProductBody(req.body);
    if (error) return res.status(400).json({ error });

    const [result] = await pool.query(
      `INSERT INTO products (category_id, name, description, price, image_url)
       VALUES (?, ?, ?, ?, ?)`,
      [data.categoryId, data.name, data.description, data.price, data.imageUrl]
    );

    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("Error al crear producto:", err);
    res.status(500).json({ error: "No se pudo crear el producto." });
  }
}

// PUT /api/admin/products/:id
async function updateProduct(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Identificador de producto inválido." });
    }

    const { error, data } = await parseProductBody(req.body);
    if (error) return res.status(400).json({ error });

    const [result] = await pool.query(
      `UPDATE products
         SET category_id = ?, name = ?, description = ?, price = ?, image_url = ?
       WHERE id = ?`,
      [data.categoryId, data.name, data.description, data.price, data.imageUrl, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "El producto no existe." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error al actualizar producto:", err);
    res.status(500).json({ error: "No se pudo actualizar el producto." });
  }
}

// DELETE /api/admin/products/:id
async function deleteProduct(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Identificador de producto inválido." });
    }

    // Los pedidos que lo incluyan conservan nombre y precio propios; el FK de
    // order_items queda en NULL (ver data/schema.sql).
    const [result] = await pool.query("DELETE FROM products WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "El producto no existe." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error al eliminar producto:", err);
    res.status(500).json({ error: "No se pudo eliminar el producto." });
  }
}

// POST /api/admin/categories
async function createCategory(req, res) {
  try {
    const name = String((req.body || {}).name || "").trim();
    if (!name) return res.status(400).json({ error: "El nombre es requerido." });
    if (name.length > 100) {
      return res
        .status(400)
        .json({ error: "El nombre no puede superar los 100 caracteres." });
    }

    const [result] = await pool.query(
      "INSERT INTO categories (name) VALUES (?)",
      [name]
    );

    res.status(201).json({ success: true, id: result.insertId, name });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ya existe una categoría con ese nombre." });
    }
    console.error("Error al crear categoría:", err);
    res.status(500).json({ error: "No se pudo crear la categoría." });
  }
}

// DELETE /api/admin/categories/:id
async function deleteCategory(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Identificador de categoría inválido." });
    }

    const [result] = await pool.query("DELETE FROM categories WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "La categoría no existe." });
    }

    res.json({ success: true });
  } catch (err) {
    // Caso esperado: la categoría todavía tiene productos. Es un conflicto de
    // datos, no un fallo del servidor.
    if (err.code === FK_IN_USE) {
      return res.status(409).json({
        error:
          "No se puede eliminar: la categoría todavía tiene productos. Muévelos o elimínalos primero.",
      });
    }
    console.error("Error al eliminar categoría:", err);
    res.status(500).json({ error: "No se pudo eliminar la categoría." });
  }
}

// GET /api/admin/orders
async function listOrders(req, res) {
  try {
    const [orders] = await pool.query(`
      SELECT id, customer_name, customer_phone, total, email_status, created_at
      FROM orders
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `);

    if (orders.length === 0) return res.json([]);

    // Una segunda consulta para el detalle en vez de un JOIN: evita repetir
    // los datos de la cabecera en cada item y arma el anidado en JS.
    const orderIds = orders.map((order) => order.id);
    const placeholders = orderIds.map(() => "?").join(",");
    const [items] = await pool.query(
      `SELECT order_id, product_name, unit_price, qty, subtotal
       FROM order_items
       WHERE order_id IN (${placeholders})
       ORDER BY id`,
      orderIds
    );

    const itemsByOrder = new Map(orderIds.map((id) => [id, []]));
    items.forEach((item) => itemsByOrder.get(item.order_id).push(item));

    res.json(
      orders.map((order) => ({ ...order, items: itemsByOrder.get(order.id) }))
    );
  } catch (err) {
    console.error("Error al listar pedidos:", err);
    res.status(500).json({ error: "No se pudieron obtener los pedidos." });
  }
}

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  createCategory,
  deleteCategory,
  listOrders,
};
