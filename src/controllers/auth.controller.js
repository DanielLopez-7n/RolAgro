const path = require("path");
const {
  checkCredentials,
  issueSession,
  clearSession,
  hasSession,
} = require("../middlewares/session");

/**
 * Entrada y salida del panel de administración.
 *
 * Las tres rutas responden con redirects y no con JSON: del otro lado hay un
 * formulario HTML común, no el fetch del panel, así que lo que corresponde es
 * mandar al navegador a la página siguiente.
 */

// GET /admin/login
function showLogin(req, res) {
  // Ya autenticado: no tiene sentido mostrarle el formulario de nuevo.
  if (hasSession(req)) return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "..", "templates", "login.html"));
}

// POST /admin/login
function login(req, res) {
  const { user, pass } = req.body || {};

  if (!checkCredentials(user, pass)) {
    // Un único mensaje para los dos casos. Decir "el usuario no existe" le
    // confirmaría a quien está probando cuál de los dos campos ya acertó, y
    // le partiría el problema al medio.
    return res.redirect("/admin/login?error=1");
  }

  issueSession(req, res);
  res.redirect("/admin");
}

// POST /admin/logout
// Es POST y no GET a propósito: una salida por GET la puede disparar
// cualquier página ajena con un <img src="/admin/logout">.
function logout(req, res) {
  clearSession(req, res);
  res.redirect("/admin/login?salida=1");
}

module.exports = { showLogin, login, logout };
