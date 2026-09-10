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
    // Se deja rastro del intento fallido porque desde afuera no se distingue
    // de uno exitoso: los dos contestan con un redirect (302), así que sin
    // esta línea fail2ban no tendría con qué separarlos en el log de Nginx.
    // El formato es estable a propósito — hay un filtro que lo lee, ver la
    // sección de fail2ban en DEPLOY.md.
    //
    // Se registra la IP y NADA de lo que escribió la persona: el usuario que
    // probó no aporta (hay uno solo válido) y meter texto ajeno en un log es
    // la forma clásica de que alguien falsifique líneas con un salto de
    // línea dentro del campo.
    console.warn(
      `${new Date().toISOString()} [auth] intento de acceso fallido al panel desde ${req.ip}`
    );

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
