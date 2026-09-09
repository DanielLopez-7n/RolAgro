const productsService = require("../services/products.service");
const categoriesService = require("../services/categories.service");
const ordersService = require("../services/orders.service");
const inventoryImportService = require("../services/inventoryImport.service");
const batchesService = require("../services/batches.service");

/**
 * Controlador del panel de administración.
 * Igual que el público: sin SQL y sin reglas de negocio. La validación de los
 * datos vive en los servicios, para que sea la misma venga la petición del
 * panel o de cualquier otra entrada futura.
 */

// GET /admin/api/products?page=&pageSize=&search=&published=
async function listProducts(req, res, next) {
  try {
    const { page, pageSize, search, published } = req.query || {};
    res.json(await productsService.findAllForAdmin({ page, pageSize, search, published }));
  } catch (err) {
    next(err);
  }
}

// GET /admin/api/products/search?q=&limit=
// Búsqueda liviana para el selector de producto del modal "Nuevo lote": no
// pasa por la paginación completa, solo devuelve las primeras coincidencias.
async function searchProducts(req, res, next) {
  try {
    const { q, limit } = req.query || {};
    res.json(await productsService.search(q, limit));
  } catch (err) {
    next(err);
  }
}

// GET /admin/api/products/:id
// Usado por el modal de edición: siempre trae el dato fresco de la base en
// vez de confiar en lo que haya en memoria del navegador, que con la tabla
// paginada puede no incluir el producto que se quiere editar.
async function getProduct(req, res, next) {
  try {
    const product = await productsService.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "El producto no existe." });
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
}

// POST /admin/api/products
async function createProduct(req, res, next) {
  try {
    const { name, description, price, category_id: categoryId, image_url: imageUrl } =
      req.body || {};

    const { id } = await productsService.create({
      name,
      description,
      price,
      categoryId,
      imageUrl,
    });

    res.status(201).json({ success: true, id });
  } catch (err) {
    next(err);
  }
}

// PUT /admin/api/products/:id
async function updateProduct(req, res, next) {
  try {
    const { name, description, price, category_id: categoryId, image_url: imageUrl } =
      req.body || {};

    await productsService.update(req.params.id, {
      name,
      description,
      price,
      categoryId,
      imageUrl,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// DELETE /admin/api/products/:id
async function deleteProduct(req, res, next) {
  try {
    await productsService.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// PATCH /admin/api/products/:id/publish
// Para sacar del catálogo público un borrador de la importación (o volver a
// esconder un producto), sin tener que reescribir el resto de sus datos
// como exige PUT /products/:id.
async function setProductPublished(req, res, next) {
  try {
    const { published } = req.body || {};
    await productsService.setPublished(req.params.id, Boolean(published));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// POST /admin/api/categories
async function createCategory(req, res, next) {
  try {
    const category = await categoriesService.create((req.body || {}).name);
    res.status(201).json({ success: true, ...category });
  } catch (err) {
    next(err);
  }
}

// DELETE /admin/api/categories/:id
async function deleteCategory(req, res, next) {
  try {
    await categoriesService.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// GET /admin/api/orders
async function listOrders(req, res, next) {
  try {
    res.json(await ordersService.findRecent());
  } catch (err) {
    next(err);
  }
}

// POST /admin/api/inventory/import
// El archivo llega en req.file.buffer (memoria): ver middlewares/uploadExcel.js.
async function importInventory(req, res, next) {
  try {
    const result = await inventoryImportService.importInventoryFromFile(req.file.buffer, {
      fileSizeBytes: req.file.size,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

// GET /admin/api/batches
async function listBatches(req, res, next) {
  try {
    res.json(await batchesService.findAllWithStatus());
  } catch (err) {
    next(err);
  }
}

// POST /admin/api/batches
async function createBatch(req, res, next) {
  try {
    const { product_id: productId, qty, expiration_date: expirationDate } = req.body || {};
    const result = await batchesService.create({ productId, qty, expirationDate });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

// DELETE /admin/api/batches/:id
async function deleteBatch(req, res, next) {
  try {
    await batchesService.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listProducts,
  searchProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  setProductPublished,
  createCategory,
  deleteCategory,
  listOrders,
  importInventory,
  listBatches,
  createBatch,
  deleteBatch,
};
