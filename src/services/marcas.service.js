const pool = require("../config/db");
const AppError = require("../utils/AppError");
const { parseId } = require("../utils/validate");

/**
 * Servicio de marcas (fabricantes): único lugar del proyecto que consulta la
 * tabla `marcas`. Mismo patrón que categories.service.js — no conoce Express,
 * recibe datos, valida reglas y lanza AppError cuando algo no cuadra.
 *
 * La diferencia frente a categories es `findOrCreate`: la importación desde
 * el ERP (ver inventoryImport.service.js) trae nombres de marca en texto
 * libre por cada fila, y necesita resolverlos a un id sin que el admin tenga
 * que dar de alta cada marca a mano de antemano.
 */

const DUPLICATE_ENTRY = "ER_DUP_ENTRY";
const FK_IN_USE = "ER_ROW_IS_REFERENCED_2";

/** Devuelve todas las marcas ordenadas por nombre. */
async function findAll() {
  const [rows] = await pool.query("SELECT id, name FROM marcas ORDER BY name");
  return rows;
}

/** Crea una marca. Lanza 409 si el nombre ya está en uso. */
async function create(rawName) {
  const name = String(rawName || "").trim();

  if (!name) {
    throw AppError.badRequest("El nombre es requerido.");
  }
  if (name.length > 100) {
    throw AppError.badRequest("El nombre no puede superar los 100 caracteres.");
  }

  try {
    const [result] = await pool.query("INSERT INTO marcas (name) VALUES (?)", [name]);
    return { id: result.insertId, name };
  } catch (err) {
    if (err.code === DUPLICATE_ENTRY) {
      throw AppError.conflict("Ya existe una marca con ese nombre.");
    }
    throw err;
  }
}

/**
 * Busca una marca por nombre (comparación exacta contra el nombre ya
 * saneado) y la crea si no existe. Es el patrón "find or create": lo usa la
 * importación del ERP para no duplicar la marca en cada fila que la
 * menciona, y para no exigirle al administrador que las cargue a mano antes
 * de importar.
 *
 * Se hace con SELECT y, si no aparece, INSERT — no INSERT ... ON DUPLICATE
 * KEY UPDATE — porque así devuelve siempre el id correcto (nuevo o
 * existente) sin depender de que `name` sea la única columna con valor.
 * Ante una carrera entre dos importaciones simultáneas (im probable: el
 * panel lo usa una sola persona), el UNIQUE de `name` en el esquema evita
 * duplicados igual; ese caso se trata como "ya existe" y se relee el id.
 */
async function findOrCreate(rawName) {
  const name = String(rawName || "").trim();
  if (!name) {
    throw AppError.badRequest("El nombre de la marca es requerido.");
  }
  if (name.length > 100) {
    throw AppError.badRequest("El nombre de la marca no puede superar los 100 caracteres.");
  }

  const [existing] = await pool.query("SELECT id FROM marcas WHERE name = ?", [name]);
  if (existing.length > 0) {
    return existing[0].id;
  }

  try {
    const [result] = await pool.query("INSERT INTO marcas (name) VALUES (?)", [name]);
    return result.insertId;
  } catch (err) {
    if (err.code === DUPLICATE_ENTRY) {
      // Otra petición la creó entre el SELECT y el INSERT de esta: se relee.
      const [rows] = await pool.query("SELECT id FROM marcas WHERE name = ?", [name]);
      if (rows.length > 0) return rows[0].id;
    }
    throw err;
  }
}

/**
 * Elimina una marca.
 * Igual que con categorías: que todavía tenga productos es un conflicto de
 * datos previsible (409), no un fallo del servidor.
 */
async function remove(rawId) {
  const id = parseId(rawId, "identificador de marca");

  try {
    const [result] = await pool.query("DELETE FROM marcas WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      throw AppError.notFound("La marca no existe.");
    }
  } catch (err) {
    if (err.code === FK_IN_USE) {
      throw AppError.conflict(
        "No se puede eliminar: la marca todavía tiene productos. Muévelos o elimínalos primero."
      );
    }
    throw err;
  }
}

module.exports = { findAll, create, findOrCreate, remove };
