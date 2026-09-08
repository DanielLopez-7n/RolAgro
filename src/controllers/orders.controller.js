const ordersService = require("../services/orders.service");

/**
 * Controlador del checkout de invitado.
 * Las reglas del pedido (validación, precios reales, transacción y aviso a la
 * empresa) viven en services/orders.service.js.
 */

// POST /api/orders
async function createOrder(req, res, next) {
  try {
    const { name, phone, items } = req.body || {};
    const result = await ordersService.placeOrder({ name, phone, items });

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = { createOrder };
