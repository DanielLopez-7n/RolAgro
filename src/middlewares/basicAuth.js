const crypto = require("crypto");

/**
 * Autenticación HTTP Basic para el panel de administración.
 *
 * Las credenciales viven en el .env (ADMIN_USER / ADMIN_PASS) y el navegador
 * muestra su propio diálogo de acceso. No hay tabla de usuarios porque el
 * panel lo usa una sola persona: la dueña del sitio.
 */

/**
 * Compara dos cadenas en tiempo constante.
 *
 * Se comparan los SHA-256 y no las cadenas crudas: timingSafeEqual exige
 * buffers del mismo largo (lanzaría con contraseñas de distinta longitud) y
 * el hash, además de igualar el tamaño, evita que el tiempo de respuesta
 * delate cuántos caracteres tiene la contraseña real.
 */
function safeEqual(a, b) {
  const hashA = crypto.createHash("sha256").update(String(a)).digest();
  const hashB = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function requestAuth(res) {
  res.set("WWW-Authenticate", 'Basic realm="RolAgro Admin", charset="UTF-8"');
  return res.status(401).json({ error: "Credenciales requeridas." });
}

function basicAuth(req, res, next) {
  const { ADMIN_USER, ADMIN_PASS } = process.env;

  // Sin credenciales configuradas el panel NO queda abierto: es preferible
  // un panel caído a uno público por un olvido en el .env.
  if (!ADMIN_USER || !ADMIN_PASS) {
    console.error(
      "El panel de administración está deshabilitado: faltan ADMIN_USER y/o ADMIN_PASS en el .env"
    );
    return res.status(503).json({
      error: "El panel de administración no está configurado en este servidor.",
    });
  }

  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    return requestAuth(res);
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  // Solo se corta en el primer ":": la contraseña puede contener más.
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return requestAuth(res);
  }

  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);

  // Se evalúan ambas siempre (sin cortocircuito) para no revelar por tiempo
  // si lo que falló fue el usuario o la contraseña.
  const userOk = safeEqual(user, ADMIN_USER);
  const passOk = safeEqual(pass, ADMIN_PASS);

  if (!userOk || !passOk) {
    return requestAuth(res);
  }

  next();
}

module.exports = basicAuth;
