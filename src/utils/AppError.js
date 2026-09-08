/**
 * Error de negocio con código HTTP asociado.
 *
 * Existe para que los servicios puedan explicar QUÉ salió mal sin saber nada
 * de Express: lanzan `new AppError("La categoría no existe", 404)` y el
 * middleware de errores lo traduce a una respuesta HTTP.
 *
 * La distinción importante es `isOperational`:
 *  - true  → error previsto (dato inválido, recurso inexistente, conflicto).
 *            Su mensaje está escrito para el usuario y se puede mostrar.
 *  - false → cualquier otra excepción (bug, MySQL caído, fallo de red). Su
 *            mensaje puede filtrar detalles internos y NUNCA se muestra.
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  /** 400 — el cliente mandó datos inválidos. */
  static badRequest(message) {
    return new AppError(message, 400);
  }

  /** 404 — el recurso pedido no existe. */
  static notFound(message) {
    return new AppError(message, 404);
  }

  /** 409 — la petición choca con el estado actual de los datos. */
  static conflict(message) {
    return new AppError(message, 409);
  }
}

module.exports = AppError;
