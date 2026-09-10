const AppError = require("../utils/AppError");

/**
 * Manejo centralizado de rutas inexistentes y de errores.
 *
 * Con esto los controladores no repiten try/catch con mensajes genéricos:
 * les basta con `next(err)` y aquí se decide qué ve el cliente.
 */

/**
 * Errores que levanta body-parser (el express.json/urlencoded de app.js) al
 * leer el cuerpo de la petición. Los marca con un `type` propio.
 *
 * Son datos de entrada malos —culpa de quien llamó, no del servidor— pero sin
 * esta tabla caían en el 500 genérico de abajo. Eso tenía dos costos: le
 * respondía "error del servidor" a alguien que mandó mal los datos, y cada
 * cuerpo malformado escribía un stack trace completo en los logs, así que
 * cualquiera podía llenar `pm2 logs` mandando basura.
 *
 * Se traduce cada tipo a un mensaje propio en vez de reenviar el de la
 * librería: los suyos vienen en inglés y con detalles internos ("Expected
 * property name or '}' in JSON at position 1").
 */
const BODY_ERRORS = {
  "entity.parse.failed": {
    status: 400,
    message: "El cuerpo de la petición no es JSON válido.",
  },
  "entity.too.large": {
    status: 413,
    message: "El cuerpo de la petición es demasiado grande.",
  },
  "encoding.unsupported": {
    status: 415,
    message: "La codificación del cuerpo de la petición no está soportada.",
  },
};

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

  // Cuerpo ilegible o demasiado grande: es un dato de entrada malo, se
  // responde como tal y no se ensucia el log del servidor.
  const bodyError = err && BODY_ERRORS[err.type];
  if (bodyError) {
    return res.status(bodyError.status).json({ error: bodyError.message });
  }

  console.error(`Error no controlado en ${req.method} ${req.originalUrl}:`, err);

  if (res.headersSent) return next(err);

  res.status(500).json({ error: "Ocurrió un error inesperado." });
}

module.exports = { notFound, errorHandler };
