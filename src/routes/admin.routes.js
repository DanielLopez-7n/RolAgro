const express = require("express");
const router = express.Router();
const basicAuth = require("../middlewares/basicAuth");
const uploadExcelFile = require("../middlewares/uploadExcel");
const { getCategories } = require("../controllers/products.controller");
const {
  listProducts,
  searchProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  setProductPublished,
  createCategory,
  deleteCategory,
  listMarcas,
  createMarca,
  deleteMarca,
  listOrders,
  importInventory,
  listBatches,
  createBatch,
  deleteBatch,
} = require("../controllers/admin.controller");

// Todo el panel exige credenciales: se aplica al router entero para que una
// ruta nueva no quede expuesta por olvido.
router.use(basicAuth);

// "/products/search" va antes que "/products/:id": si quedara después,
// Express probaría primero la ruta con parámetro y "search" se colaría como
// si fuera un id.
router.get("/products/search", searchProducts);
router.get("/products", listProducts);
router.get("/products/:id", getProduct);
router.post("/products", createProduct);
router.put("/products/:id", updateProduct);
router.patch("/products/:id/publish", setProductPublished);
router.delete("/products/:id", deleteProduct);

// El listado de categorías es idéntico al público: se reutiliza el mismo
// controlador en lugar de duplicar la consulta.
router.get("/categories", getCategories);
router.post("/categories", createCategory);
router.delete("/categories/:id", deleteCategory);

// Las marcas no tienen listado público: solo se administran desde acá y las
// crea también la importación del ERP (find-or-create, ver marcas.service.js).
router.get("/marcas", listMarcas);
router.post("/marcas", createMarca);
router.delete("/marcas/:id", deleteMarca);

router.get("/orders", listOrders);

// La subida del Excel del ERP corre antes del controlador: deja el archivo
// en req.file.buffer (memoria, no disco) o corta con un 400 si el archivo
// falta, pesa de más o no es .xlsx (ver middlewares/uploadExcel.js).
router.post("/inventory/import", uploadExcelFile, importInventory);

router.get("/batches", listBatches);
router.post("/batches", createBatch);
router.delete("/batches/:id", deleteBatch);

module.exports = router;
