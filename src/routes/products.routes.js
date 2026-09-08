const express = require("express");
const router = express.Router();
const {
  getCategories,
  getProducts,
  getPublicConfig,
} = require("../controllers/products.controller");

router.get("/categories", getCategories);
router.get("/products", getProducts);
router.get("/config", getPublicConfig);

module.exports = router;
