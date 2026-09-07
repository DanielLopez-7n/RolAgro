const pool = require("../config/db");

// GET /api/categories
async function getCategories(req, res) {
  try {
    const [rows] = await pool.query(
      "SELECT id, name FROM categories ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener categorías:", err);
    res.status(500).json({ error: "No se pudieron obtener las categorías." });
  }
}

// GET /api/products  (opcional: ?category=<id>)
async function getProducts(req, res) {
  try {
    const { category } = req.query;

    let sql = `
      SELECT p.id, p.name, p.description, p.price, p.image_url,
             c.id AS category_id, c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
    `;
    const params = [];

    if (category) {
      sql += " WHERE p.category_id = ?";
      params.push(category);
    }

    sql += " ORDER BY p.id";

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener productos:", err);
    res.status(500).json({ error: "No se pudieron obtener los productos." });
  }
}

module.exports = { getCategories, getProducts };
