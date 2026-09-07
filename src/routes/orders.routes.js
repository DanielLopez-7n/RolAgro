const express = require("express");
const router = express.Router();
const { createOrder } = require("../controllers/orders.controller");
const { orderLimiter } = require("../middlewares/rateLimiter");

// El límite estricto va solo aquí: cada pedido dispara un correo.
router.post("/orders", orderLimiter, createOrder);

module.exports = router;
