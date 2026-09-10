const express = require("express");
const router = express.Router();
const { showLogin, login, logout } = require("../controllers/auth.controller");
const { loginLimiter } = require("../middlewares/rateLimiter");

/**
 * Rutas de entrada al panel. Van montadas en /admin (ver src/app.js) y son
 * las ÚNICAS de ese prefijo que no exigen sesión: si el login la exigiera, no
 * habría forma de conseguir una.
 *
 * El cuerpo llega como formulario (application/x-www-form-urlencoded), no
 * como JSON: es un <form> HTML de verdad, que funciona aunque el JavaScript
 * de la página falle.
 */

router.get("/login", showLogin);

// El límite va solo en el POST: es el único punto donde se prueban
// contraseñas. Mostrar el formulario (GET) no cuesta nada y no debe gastar
// cupo, o recargar la página de a ratos te dejaría afuera.
router.post("/login", loginLimiter, login);

router.post("/logout", logout);

module.exports = router;
