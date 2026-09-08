const pool = require("../config/db");
const AppError = require("../utils/AppError");
const { parseId } = require("../utils/validate");

/**
 * Servicio de categorías: único lugar del proyecto que consulta la tabla
 * `categories`. No conoce Express — recibe datos, valida reglas y lanza
 * AppError cuando algo no cuadra.
 */

// MySQL avisa con este código cuando otra tabla todavía apunta a la fila que
// se intenta borrar (una categoría con productos dentro).
const FK_IN_USE = "ER_ROW_IS_REFERENCED_2";
const DUPLICATE_ENTRY = "ER_DUP_ENTRY";

/** Devuelve todas las categorías ordenadas por nombre. */
async function findAll() {
  const [rows] = await pool.query("SELECT id, name FROM categories ORDER BY name");
  return rows;
}

/** Comprueba si una categoría existe. Se usa al validar productos. */
async function exists(id) {
  const [rows] = await pool.query("SELECT id FROM categories WHERE id = ?", [id]);
  return rows.length > 0;
}

/** Crea una categoría. Lanza 409 si el nombre ya está en uso. */
async function create(rawName) {
  const name = String(rawName || "").trim();

  if (!name) {
    throw AppError.badRequest("El nombre es requerido.");
  }
  if (name.length > 100) {
    throw AppError.badRequest("El nombre no puede superar los 100 caracteres.");
  }

  try {
    const [result] = await pool.query("INSERT INTO categories (name) VALUES (?)", [
      name,
    ]);
    return { id: result.insertId, name };
  } catch (err) {
    if (err.code === DUPLICATE_ENTRY) {
      throw AppError.conflict("Ya existe una categoría con ese nombre.");
    }
    throw err;
  }
}

/**
 * Elimina una categoría.
 * Que todavía tenga productos es un conflicto de datos previsible (409), no
 * un fallo del servidor: se traduce aquí para que el controlador no tenga que
 * interpretar códigos de error de MySQL.
 */
async function remove(rawId) {
  const id = parseId(rawId, "identificador de categoría");

  try {
    const [result] = await pool.query("DELETE FROM categories WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      throw AppError.notFound("La categoría no existe.");
    }
  } catch (err) {
    if (err.code === FK_IN_USE) {
      throw AppError.conflict(
        "No se puede eliminar: la categoría todavía tiene productos. Muévelos o elimínalos primero."
      );
    }
    throw err;
  }
}

module.exports = { findAll, exists, create, remove };
