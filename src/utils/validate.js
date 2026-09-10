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
  // Se exige la forma exacta de un entero, y no "lo que Number() sepa
  // convertir". Number() es mucho más permisivo de lo que parece: "1e3" da
  // 1000, "0x10" da 16, "+5" da 5 y "  12  " da 12. Ninguno es peligroso por
  // sí mismo —terminan como números pasados por parámetro, no como texto en
  // la consulta— pero ninguno lo tipeó nadie de buena fe, y con el atajo de
  // Number() esas URL raras llegaban hasta la base de datos.
  const enteroEnTexto = typeof value === "string" && /^\d+$/.test(value);
  const enteroNumerico = typeof value === "number" && Number.isInteger(value);

  if (!enteroEnTexto && !enteroNumerico) {
    throw AppError.badRequest(`El ${label} no es válido.`);
  }

  const id = Number(value);
  if (id <= 0) {
    throw AppError.badRequest(`El ${label} no es válido.`);
  }
  return id;
}

module.exports = { parseId };
