const productsService = require("../services/products.service");
const categoriesService = require("../services/categories.service");
const whatsappService = require("../services/whatsapp.service");

/**
 * Controlador público del catálogo.
 * Solo traduce entre HTTP y los servicios: lee la petición, delega y responde.
 * Ninguna consulta SQL vive aquí.
 */

// GET /api/categories
async function getCategories(req, res, next) {
  try {
    res.json(await categoriesService.findAll());
  } catch (err) {
    next(err);
  }
}

// GET /api/products  (opcional: ?category=<id>)
async function getProducts(req, res, next) {
  try {
    res.json(await productsService.findAll({ categoryId: req.query.category }));
  } catch (err) {
    next(err);
  }
}

// GET /api/config
// Configuración pública que el frontend necesita conocer. Solo se expone el
// número de WhatsApp: el resto del .env (credenciales de correo, de base de
// datos y del panel) nunca debe salir del servidor.
function getPublicConfig(req, res) {
  res.json({ whatsappNumber: whatsappService.getNumber() });
}

module.exports = { getCategories, getProducts, getPublicConfig };
