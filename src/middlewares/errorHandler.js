const AppError = require("../utils/AppError");

/**
 * Manejo centralizado de rutas inexistentes y de errores.
 *
 * Con esto los controladores no repiten try/catch con mensajes genéricos:
 * les basta con `next(err)` y aquí se decide qué ve el cliente.
 */

/** Ninguna ruta coincidió. */
function notFound(req, res) {
  // La API siempre responde JSON: el frontend hace res.json() sobre todo lo
  // que recibe y un HTML de error lo haría fallar de forma confusa.
  if (req.path.startsWith("/api") || req.path.startsWith("/admin/api")) {
    return res.status(404).json({ error: "Recurso no encontrado." });
  }
  res.status(404).type("text").send("404 - Página no encontrada");
}

/**
 * Traduce cualquier excepción a una respuesta HTTP.
 *
 * Los AppError llevan su propio código y un mensaje pensado para el usuario.
 * Todo lo demás (bug, MySQL caído, fallo de red) es un 500 con mensaje
 * genérico: el detalle queda en la consola del servidor y nunca se envía al
 * cliente, para no filtrar rutas, consultas ni stack traces.
 */
// eslint-disable-next-line no-unused-vars -- Express exige los 4 parámetros.
function errorHandler(err, req, res, next) {
  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  console.error(`Error no controlado en ${req.method} ${req.originalUrl}:`, err);

  if (res.headersSent) return next(err);

  res.status(500).json({ error: "Ocurrió un error inesperado." });
}

module.exports = { notFound, errorHandler };
