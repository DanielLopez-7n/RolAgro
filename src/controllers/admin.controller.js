const productsService = require("../services/products.service");
const categoriesService = require("../services/categories.service");
const ordersService = require("../services/orders.service");

/**
 * Controlador del panel de administración.
 * Igual que el público: sin SQL y sin reglas de negocio. La validación de los
 * datos vive en los servicios, para que sea la misma venga la petición del
 * panel o de cualquier otra entrada futura.
 */

// GET /admin/api/products
async function listProducts(req, res, next) {
  try {
    res.json(await productsService.findAllForAdmin());
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

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  createCategory,
  deleteCategory,
  listOrders,
};
