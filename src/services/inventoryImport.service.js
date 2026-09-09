const ExcelJS = require("exceljs");
const AppError = require("../utils/AppError");

/**
 * Importación de inventario desde el Excel que exporta el ERP de la tienda
 * física ("SALDOS DE INVENTARIO...").
 *
 * El archivo NO es una tabla plana: es un reporte visual pensado para
 * imprimirse. Antes de la fila de encabezado trae 4-5 filas de membrete
 * (razón social, NIT, título del reporte, bodega), y entre los productos
 * intercala "filas de título" que solo tienen la marca en la primera columna
 * (agrupan visualmente los productos de esa marca, sin ninguna otra celda
 * llena). Todo eso hay que reconocerlo y saltarlo sin que la importación
 * falle ni cuente esas filas como productos.
 *
 * Este módulo separa dos responsabilidades:
 *   - parseInventoryWorkbook: solo lee y sanea filas. No toca la base de
 *     datos, así que se puede probar con un archivo de ejemplo armado en
 *     memoria (ver test/inventoryImport.service.test.js), igual que
 *     orders.service.js separa validateCustomer de placeOrder.
 *   - importInventory: toma esas filas ya limpias y las aplica contra
 *     marcas/products. Recibe las funciones de acceso a datos por parámetro
 *     (inyección de dependencias) para poder probarlo también sin MySQL.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB: de sobra para un reporte de texto de unas pocas miles de filas.

// Categoría donde caen los productos que crea la importación: el archivo del
// ERP no trae ninguna columna de categoría, así que no hay forma de elegir
// una real fila por fila. Quedan agrupados acá para que el administrador los
// reubique a mano desde el panel (ver categories.service.js findOrCreate).
const FALLBACK_CATEGORY_NAME = "Sin categorizar";

// Nombres de columna esperados en la fila de encabezado del reporte,
// buscados sin distinguir mayúsculas ni espacios extra. REFERENCIA/DETALLE
// son obligatorias; el resto (incluidas las de vencimiento) son opcionales:
// un export de saldos "viejo", sin esas dos columnas, se sigue procesando
// igual, solo que sin tocar los lotes.
const EXPECTED_HEADERS = ["REFERENCIA", "DETALLE", "MARCA", "CANTIDAD"];
const EXPIRATION_QTY_HEADER = "VENCIDOS Y PROXIMOS A VENCER";
const EXPIRATION_DATE_HEADER = "FECHA";
const MAX_HEADER_SEARCH_ROWS = 50; // Las filas de membrete son 4-5; 50 da margen sin recorrer el archivo entero en vano.

/**
 * Limpia un valor de celda: lo convierte a texto, recorta los espacios de
 * los extremos y colapsa espacios internos repetidos a uno solo.
 *
 * El export del ERP rellena cada celda con espacios hasta un ancho fijo
 * (ej. "00000               ") y a veces deja dobles espacios en nombres de
 * producto (ej. "ADE  MAGNESIO  X LT"); sin este saneo, esas mismas
 * referencias/nombres no volverían a coincidir en la próxima importación.
 */
function sanitizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Decide si una fila es un producto real o "basura visual" del reporte
 * (membrete, fila de título de marca, fila en blanco, la propia fila de
 * encabezado si se la vuelve a encontrar más abajo).
 *
 * Regla acordada: una fila solo cuenta como producto si REFERENCIA y
 * DETALLE, ya saneadas, tienen contenido. Las filas de título de marca
 * (ej. "ABC RIEGO" solo en la primera columna) tienen DETALLE vacío y caen
 * acá; el membrete y las filas en blanco, también.
 */
function isValidDataRow(referencia, detalle) {
  return referencia.length > 0 && detalle.length > 0;
}

/** Ubica, en una fila, la columna cuyo texto saneado coincide con `label`. */
function findColumn(row, label) {
  let found = null;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (found) return;
    if (sanitizeText(cell.value).toUpperCase() === label) {
      found = colNumber;
    }
  });
  return found;
}

/**
 * Busca la fila de encabezado real (REFERENCIA/DETALLE/MARCA/CANTIDAD) entre
 * las primeras filas del reporte y devuelve en qué número de fila está y en
 * qué columna cae cada campo.
 *
 * No se asume una posición fija (ej. "siempre fila 6, columnas A-D"): se
 * busca por contenido, para que un membrete más largo o corto, o una
 * columna reordenada, no rompan la importación en silencio.
 */
function findHeader(worksheet) {
  const limit = Math.min(worksheet.rowCount, MAX_HEADER_SEARCH_ROWS);

  for (let rowNumber = 1; rowNumber <= limit; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const referenciaCol = findColumn(row, "REFERENCIA");
    const detalleCol = findColumn(row, "DETALLE");

    if (referenciaCol && detalleCol) {
      return {
        rowNumber,
        referenciaCol,
        detalleCol,
        marcaCol: findColumn(row, "MARCA"), // Puede no existir en otro export; se maneja como opcional.
        cantidadCol: findColumn(row, "CANTIDAD"),
        // Solo aparecen en la versión del reporte que ya trae vencimientos
        // marcados (ver parseInventoryWorkbook); si no están, quedan null y
        // el resto de la importación (marcas/productos) sigue funcionando.
        expirationQtyCol: findColumn(row, EXPIRATION_QTY_HEADER),
        expirationDateCol: findColumn(row, EXPIRATION_DATE_HEADER),
      };
    }
  }

  throw AppError.badRequest(
    `No se encontró la fila de encabezado (se buscó "${EXPECTED_HEADERS.join(", ")}" ` +
      `en las primeras ${limit} filas). ¿Es el archivo de saldos de inventario correcto?`
  );
}

/**
 * Lee un workbook ya cargado con ExcelJS y devuelve solo las filas de
 * producto válidas, saneadas, junto con un conteo de lo que se saltó.
 *
 * No toca la base de datos: es la parte que se puede probar de forma
 * aislada.
 */
function parseInventoryWorkbook(workbook) {
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw AppError.badRequest("El archivo no tiene ninguna hoja.");
  }

  const header = findHeader(worksheet);
  const rows = [];
  let skippedRows = 0;

  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    const sku = sanitizeText(row.getCell(header.referenciaCol).value);
    const name = sanitizeText(row.getCell(header.detalleCol).value);

    // Acá se descartan tanto las filas de título de marca (solo REFERENCIA,
    // con el nombre de la marca metido ahí, sin DETALLE) como cualquier fila
    // en blanco o de membrete que haya quedado por debajo del encabezado.
    if (!isValidDataRow(sku, name)) {
      skippedRows++;
      continue;
    }

    const marca = header.marcaCol ? sanitizeText(row.getCell(header.marcaCol).value) : "";
    const rawCantidad = header.cantidadCol ? row.getCell(header.cantidadCol).value : null;
    const cantidad = Number.isFinite(Number(rawCantidad)) ? Number(rawCantidad) : null;

    // Un lote solo cuenta si la fila trae LAS DOS cosas: cuánto y cuándo. Una
    // sola de las dos (ej. una fecha suelta sin cantidad) no alcanza para
    // registrar nada y se descarta en silencio — no es basura de la fila,
    // es un dato incompleto para lo que necesita product_batches.
    const rawExpirationQty = header.expirationQtyCol
      ? row.getCell(header.expirationQtyCol).value
      : null;
    const rawExpirationDate = header.expirationDateCol
      ? row.getCell(header.expirationDateCol).value
      : null;
    const expirationQty = Number.isFinite(Number(rawExpirationQty))
      ? Number(rawExpirationQty)
      : null;
    const expirationDate = rawExpirationDate instanceof Date ? rawExpirationDate : null;
    const hasExpiration = expirationQty !== null && expirationDate !== null;

    rows.push({
      sku,
      name,
      marca: marca || null,
      cantidad,
      expirationQty: hasExpiration ? expirationQty : null,
      expirationDate: hasExpiration ? expirationDate : null,
      rowNumber,
    });
  }

  return { rows, skippedRows, headerRowNumber: header.rowNumber };
}

/**
 * Agrupa las filas por sku y separa las que están duplicadas dentro del
 * mismo archivo.
 *
 * El código REFERENCIA del ERP NO es único en todo su catálogo: los códigos
 * cortos (1-3 dígitos) se reutilizan entre productos completamente distintos
 * (comprobado contra el archivo real: ej. la referencia "1" es a la vez un
 * "RASTRILLO" y un "CONECTOR CINTA-CINTA"). Aplicar la fila que llegue
 * última en el archivo sin avisar actualizaría la marca del producto
 * equivocado sin que nadie lo note. Estos casos se separan aparte y no se
 * aplican nunca de forma automática.
 */
function splitAmbiguousRows(rows) {
  const bySku = new Map();
  for (const row of rows) {
    if (!bySku.has(row.sku)) bySku.set(row.sku, []);
    bySku.get(row.sku).push(row);
  }

  const safeRows = [];
  const ambiguous = [];
  for (const group of bySku.values()) {
    if (group.length === 1) {
      safeRows.push(group[0]);
    } else {
      ambiguous.push({
        sku: group[0].sku,
        occurrences: group.map((r) => ({ name: r.name, rowNumber: r.rowNumber })),
      });
    }
  }

  return { safeRows, ambiguous };
}

/**
 * Aplica las filas ya parseadas contra la base de datos.
 *
 * Para cada fila con un sku que YA existe en el catálogo: resuelve la marca
 * (find-or-create) y actualiza solo eso — nunca toca precio, descripción ni
 * categoría, que son del alta manual.
 *
 * Para cada fila con un sku que NO existe todavía: crea el producto como
 * borrador (`published = 0`, precio $0, categoría "Sin categorizar") en vez
 * de descartarlo. El archivo del ERP no trae precio ni categoría reales, así
 * que el producto queda invisible en el catálogo público hasta que el
 * administrador lo revise y le cargue esos datos desde el panel (ver
 * findAll/createFromImport en products.service.js).
 *
 * Nunca aplica un sku que se repita dentro del mismo archivo (ver
 * splitAmbiguousRows): se reporta aparte para que el administrador lo
 * resuelva a mano, en vez de adivinar cuál de las filas es la correcta. Por
 * la misma razón, tampoco registra el lote de esas filas: sin saber a qué
 * producto pertenecen, tampoco se puede saber a qué producto pertenece su
 * fecha de vencimiento.
 *
 * Cuando la fila trae cantidad y fecha de vencimiento (columnas
 * "VENCIDOS Y PROXIMOS A VENCER"/"FECHA" del export, ver parseInventoryWorkbook),
 * se registra o actualiza el lote del producto ya emparejado —tanto si ya
 * existía como si se acaba de crear como borrador— con `upsertBatch`
 * (product_batches.service.js): reimportar el mismo archivo actualiza la
 * cantidad del lote en vez de duplicarlo.
 *
 * Las funciones de acceso a datos entran por parámetro (inyección de
 * dependencias): en producción son de marcas.service.js/categories.service.js/
 * products.service.js/batches.service.js; en las pruebas son funciones
 * falsas en memoria, para poder probar la orquestación completa sin MySQL.
 */
async function importInventory(
  workbook,
  {
    findOrCreateMarca,
    findProductBySku,
    updateProductMarca,
    findOrCreateCategory,
    createProduct,
    upsertBatch,
  }
) {
  const { rows, skippedRows } = parseInventoryWorkbook(workbook);
  const { safeRows, ambiguous } = splitAmbiguousRows(rows);

  const result = {
    totalDataRows: rows.length,
    skippedRows,
    updated: 0, // productos que ya existían y se les completó la marca.
    created: 0, // productos nuevos, creados como borrador (sin publicar).
    createdProducts: [], // { id, sku, name, rowNumber }: para que el admin sepa qué revisar.
    ambiguousSkus: ambiguous, // { sku, occurrences: [{name, rowNumber}] }: códigos repetidos en el propio archivo, nunca se aplican solos.
    batchesUpserted: 0, // lotes con fecha de vencimiento creados o actualizados.
  };

  // Cache local de nombre de marca -> id, para no repetir el find-or-create
  // en cada fila cuando la misma marca aparece muchas veces seguidas (es lo
  // normal: el reporte agrupa los productos por marca).
  const marcaIdByName = new Map();
  // La categoría de respaldo se resuelve como mucho una vez por importación,
  // y solo si hace falta (un archivo que reenriquece productos ya cargados
  // no necesita crear ninguna).
  let fallbackCategoryId = null;

  for (const row of safeRows) {
    let marcaId = null;
    if (row.marca) {
      // Se pregunta por la clave (has), no por el valor: un id falsy — 0, o
      // lo que devuelva una función falsa en un test — volvería a consultar
      // en cada fila si el chequeo fuera "if (!marcaId)".
      if (!marcaIdByName.has(row.marca)) {
        marcaIdByName.set(row.marca, await findOrCreateMarca(row.marca));
      }
      marcaId = marcaIdByName.get(row.marca);
    }

    const product = await findProductBySku(row.sku);
    let productId;

    if (product) {
      // Solo se toca marca_id cuando la fila realmente trae una marca: dejar
      // esta columna vacía en el Excel no debe borrar una marca ya cargada.
      if (marcaId) {
        await updateProductMarca(product.id, marcaId);
      }
      result.updated++;
      productId = product.id;
    } else {
      if (fallbackCategoryId === null) {
        fallbackCategoryId = await findOrCreateCategory(FALLBACK_CATEGORY_NAME);
      }

      const created = await createProduct({
        sku: row.sku,
        name: row.name,
        marcaId,
        categoryId: fallbackCategoryId,
      });
      result.created++;
      result.createdProducts.push({
        id: created.id,
        sku: row.sku,
        name: row.name,
        rowNumber: row.rowNumber,
      });
      productId = created.id;
    }

    if (row.expirationQty !== null && row.expirationDate !== null) {
      await upsertBatch({
        productId,
        qty: row.expirationQty,
        expirationDate: row.expirationDate,
      });
      result.batchesUpserted++;
    }
  }

  return result;
}

/**
 * Punto de entrada real: lee un archivo .xlsx desde disco (o un Buffer, por
 * ejemplo el que entrega un middleware de subida de archivos) y lo importa
 * usando los servicios reales de marcas y productos.
 */
async function importInventoryFromFile(filePathOrBuffer, { fileSizeBytes } = {}) {
  if (typeof fileSizeBytes === "number" && fileSizeBytes > MAX_FILE_BYTES) {
    throw AppError.badRequest(
      `El archivo supera el tamaño máximo permitido (${MAX_FILE_BYTES / 1024 / 1024} MB).`
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    if (Buffer.isBuffer(filePathOrBuffer)) {
      await workbook.xlsx.load(filePathOrBuffer);
    } else {
      await workbook.xlsx.readFile(filePathOrBuffer);
    }
  } catch (err) {
    // Un archivo que no es un .xlsx válido (otro formato, corrupto, o un
    // .xls viejo) no debe tumbar el servidor: es un dato de entrada malo,
    // no un bug.
    throw AppError.badRequest(
      "El archivo no se pudo leer. Verificá que sea un Excel (.xlsx) válido y no esté dañado."
    );
  }

  // Requiere que estos servicios ya estén cargados; se importan acá (no
  // arriba del archivo) para no crear una dependencia circular si en el
  // futuro alguno de ellos necesita este módulo.
  const marcasService = require("./marcas.service");
  const categoriesService = require("./categories.service");
  const productsService = require("./products.service");
  const batchesService = require("./batches.service");

  return importInventory(workbook, {
    findOrCreateMarca: marcasService.findOrCreate,
    findProductBySku: productsService.findBySku,
    updateProductMarca: productsService.updateMarca,
    findOrCreateCategory: categoriesService.findOrCreate,
    createProduct: productsService.createFromImport,
    upsertBatch: batchesService.upsert,
  });
}

module.exports = {
  sanitizeText,
  isValidDataRow,
  parseInventoryWorkbook,
  splitAmbiguousRows,
  importInventory,
  importInventoryFromFile,
  MAX_FILE_BYTES,
  FALLBACK_CATEGORY_NAME,
};
