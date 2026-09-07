const express = require("express");
const router = express.Router();
const { getCategories, getProducts } = require("../controllers/products.controller");

router.get("/categories", getCategories);
router.get("/products", getProducts);

module.exports = router;
