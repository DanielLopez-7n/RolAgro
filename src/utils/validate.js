const AppError = require("./AppError");

/**
 * Validaciones de entrada compartidas por los servicios.
 */

/**
 * Normaliza un identificador que llega del exterior (parámetro de ruta, query
 * string o cuerpo de la petición) y falla si no es un entero positivo.
 *
 * Se usa antes de cualquier consulta: aunque las sentencias van siempre con
 * parámetros, un id con un valor inesperado (null, un objeto, un array) puede
 * producir consultas raras o resultados vacíos difíciles de diagnosticar.
 */
function parseId(value, label = "identificador") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw AppError.badRequest(`El ${label} no es válido.`);
  }
  return id;
}

module.exports = { parseId };
