const express = require("express");
const router = express.Router();
const basicAuth = require("../middlewares/basicAuth");
const { getCategories } = require("../controllers/products.controller");
const {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  createCategory,
  deleteCategory,
  listOrders,
} = require("../controllers/admin.controller");

// Todo el panel exige credenciales: se aplica al router entero para que una
// ruta nueva no quede expuesta por olvido.
router.use(basicAuth);

router.get("/products", listProducts);
router.post("/products", createProduct);
router.put("/products/:id", updateProduct);
router.delete("/products/:id", deleteProduct);

// El listado de categorías es idéntico al público: se reutiliza el mismo
// controlador en lugar de duplicar la consulta.
router.get("/categories", getCategories);
router.post("/categories", createCategory);
router.delete("/categories/:id", deleteCategory);

router.get("/orders", listOrders);

module.exports = router;
