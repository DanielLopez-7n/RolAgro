const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const {
  sanitizeText,
  isValidDataRow,
  parseInventoryWorkbook,
  splitAmbiguousRows,
  importInventory,
} = require("../src/services/inventoryImport.service");

/**
 * Importación del inventario del ERP.
 *
 * El archivo real ("SALDOS DE INVENTARIO...") no es una tabla plana: antes
 * del encabezado trae membrete (razón social, NIT, título, bodega) y entre
 * los productos intercala filas de título que solo tienen el nombre de la
 * marca en la primera columna. Estas pruebas arman esa misma forma en
 * memoria con ExcelJS (sin abrir ningún archivo ni tocar MySQL) para
 * asegurarse de que esa "basura visual" se salta sin romper la importación.
 */

/** Arma un workbook con la misma forma que el export real del ERP. */
function buildSampleWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja1");

  sheet.addRow(["NESTOR ROLANDO AVILA SANCHEZ"]); // 1: membrete
  sheet.addRow(["NIT. 1057214047-3"]); // 2: membrete
  sheet.addRow([]); // 3: fila en blanco
  sheet.addRow(["SALDOS DE INVENTARIO A Septiembre de 2026"]); // 4: membrete
  sheet.addRow(["Bodega : BODEGA PRINCIPAL"]); // 5: membrete
  sheet.addRow(["REFERENCIA", "DETALLE", "MARCA", "CANTIDAD"]); // 6: encabezado real
  sheet.addRow(["00000               ", "PRODUCTO DEMOSTRACION   ", "", 0]); // 7: producto sin marca
  sheet.addRow(["ABC RIEGO                                                   "]); // 8: fila de título de marca
  sheet.addRow(["2161                ", "CINTA GOTEO EN LINEA - 8 MIL", "ABC RIEGO                  ", 0]); // 9
  sheet.addRow([]); // 10: fila en blanco entre grupos
  sheet.addRow(["3006                ", "KLIP-K CALCIO-BORO X 4 LTS", "ABC RIEGO                  ", 5]); // 11

  return workbook;
}

/**
 * Arma un workbook con las columnas de vencimiento que trae la versión
 * nueva del reporte del ERP: E "VENCIDOS Y PROXIMOS A VENCER" (cantidad del
 * lote) y F "FECHA". Incluye la fila de resumen que el ERP deja al final del
 * archivo real (E/F sueltos, sin REFERENCIA ni DETALLE), para probar que se
 * ignora igual que cualquier otra fila sin producto.
 */
function buildWorkbookWithExpirations() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja1");

  sheet.addRow(["REFERENCIA", "DETALLE", "MARCA", "CANTIDAD", "VENCIDOS Y PROXIMOS A VENCER", "FECHA"]);
  // Vencido: coincide con la fila 871 real (ATA-K-DUO, venció 15-08-2026).
  sheet.addRow(["2667", "ATA-K-DUO 450 SC * LT", "AGROACTIVA", 2, 2, new Date(Date.UTC(2026, 7, 15))]);
  // Sin datos de vencimiento: producto normal, sin lote registrado.
  sheet.addRow(["00006", "13-40-15 X 50 KL", "", 0]);
  // Próximo a vencer, no vencido: coincide con la fila 1172 real.
  sheet.addRow(["0898", "CENTELLA X 250CC", "ALTRIA", 5, 5, new Date(Date.UTC(2026, 11, 18))]);
  // Fila de resumen del final del archivo real: E y F sueltos, sin producto.
  sheet.addRow([null, null, null, null, "TOTAL VENCIDOS", 3197]);

  return workbook;
}

test("sanitizeText recorta y colapsa espacios, y no explota con null/undefined", () => {
  assert.equal(sanitizeText("00000               "), "00000");
  assert.equal(sanitizeText("ADE  MAGNESIO  X LT"), "ADE MAGNESIO X LT");
  assert.equal(sanitizeText(null), "");
  assert.equal(sanitizeText(undefined), "");
  assert.equal(sanitizeText(0), "0"); // una cantidad en 0 no debe tratarse como "vacío"
});

test("isValidDataRow exige referencia y detalle, no alcanza con uno solo", () => {
  assert.equal(isValidDataRow("2161", "CINTA GOTEO"), true);
  assert.equal(isValidDataRow("ABC RIEGO", ""), false); // fila de título de marca
  assert.equal(isValidDataRow("", ""), false); // fila en blanco
  assert.equal(isValidDataRow("", "DETALLE SIN REFERENCIA"), false);
});

test("parseInventoryWorkbook encuentra el encabezado real y salta membrete, filas de título y blancos", () => {
  const { rows, skippedRows, headerRowNumber } = parseInventoryWorkbook(buildSampleWorkbook());

  assert.equal(headerRowNumber, 6);
  assert.equal(rows.length, 3, "deberían quedar solo las 3 filas de producto reales");
  assert.equal(skippedRows, 2, "la fila de título ABC RIEGO y la fila en blanco, después del encabezado");

  assert.deepEqual(
    rows.map((r) => r.sku),
    ["00000", "2161", "3006"]
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["PRODUCTO DEMOSTRACION", "CINTA GOTEO EN LINEA - 8 MIL", "KLIP-K CALCIO-BORO X 4 LTS"]
  );
});

test("parseInventoryWorkbook deja la marca en null cuando la fila no trae una", () => {
  const { rows } = parseInventoryWorkbook(buildSampleWorkbook());

  assert.equal(rows[0].marca, null); // fila del producto demostración, sin marca en el ERP
  assert.equal(rows[1].marca, "ABC RIEGO");
  assert.equal(rows[2].marca, "ABC RIEGO");
});

test("parseInventoryWorkbook rechaza un archivo sin la fila de encabezado esperada", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja1");
  sheet.addRow(["Esto no es un reporte de inventario"]);
  sheet.addRow(["Ni tiene REFERENCIA ni DETALLE en ningún lado"]);

  assert.throws(() => parseInventoryWorkbook(workbook), { statusCode: 400 });
});

test("importInventory actualiza por sku, reutiliza la marca ya resuelta y no vuelve a crear productos existentes", async () => {
  const productsBySku = {
    "00000": { id: 1 },
    "2161": { id: 2 },
    "3006": { id: 3 },
  };
  const marcaCalls = [];
  const updateCalls = [];

  const result = await importInventory(buildSampleWorkbook(), {
    findOrCreateMarca: async (name) => {
      marcaCalls.push(name);
      return name === "ABC RIEGO" ? 42 : -1;
    },
    findProductBySku: async (sku) => productsBySku[sku] || null,
    updateProductMarca: async (productId, marcaId) => {
      updateCalls.push({ productId, marcaId });
    },
    findOrCreateCategory: async () => {
      throw new Error("no debería resolver la categoría de respaldo: todos los sku ya existen");
    },
    createProduct: async () => {
      throw new Error("no debería crear ningún producto: todos los sku ya existen");
    },
  });

  assert.equal(result.totalDataRows, 3);
  assert.equal(result.skippedRows, 2);
  assert.equal(result.updated, 3);
  assert.equal(result.created, 0);
  assert.deepEqual(result.createdProducts, []);

  // La marca "ABC RIEGO" aparece en 2 de las 3 filas: find-or-create debe
  // llamarse una sola vez para ella (se cachea dentro de la importación), no
  // dos.
  assert.deepEqual(marcaCalls, ["ABC RIEGO"]);

  // El producto sin marca en el archivo (sku 00000) no debe recibir ninguna
  // actualización de marca_id: no hay que confundir "sin dato" con "borrar
  // la marca que ya tenía cargada".
  assert.deepEqual(updateCalls, [
    { productId: 2, marcaId: 42 },
    { productId: 3, marcaId: 42 },
  ]);
});

test("importInventory crea como borrador los sku que no existen, sin interrumpir el resto", async () => {
  const createCalls = [];

  const result = await importInventory(buildSampleWorkbook(), {
    findOrCreateMarca: async (name) => (name === "ABC RIEGO" ? 42 : -1),
    // Solo "2161" existe en el catálogo; "00000" y "3006" no.
    findProductBySku: async (sku) => (sku === "2161" ? { id: 2 } : null),
    updateProductMarca: async () => {},
    findOrCreateCategory: async (name) => {
      assert.equal(name, "Sin categorizar");
      return 999;
    },
    createProduct: async ({ sku, name, marcaId, categoryId }) => {
      createCalls.push({ sku, name, marcaId, categoryId });
      return { id: 1000 + createCalls.length };
    },
  });

  assert.equal(result.updated, 1);
  assert.equal(result.created, 2);
  assert.deepEqual(
    result.createdProducts.map((c) => c.sku),
    ["00000", "3006"]
  );
  // rowNumber sirve para que el admin ubique la fila en el Excel original;
  // id es el del producto recién creado, para poder ir a editarlo directo.
  assert.equal(result.createdProducts[0].rowNumber, 7);
  assert.equal(result.createdProducts[0].id, 1001);
  assert.equal(result.createdProducts[1].rowNumber, 11);

  // El producto sin marca (sku 00000) se crea con marcaId null, no con la
  // marca de la fila anterior ni con undefined (que rompería el INSERT).
  assert.deepEqual(createCalls, [
    { sku: "00000", name: "PRODUCTO DEMOSTRACION", marcaId: null, categoryId: 999 },
    { sku: "3006", name: "KLIP-K CALCIO-BORO X 4 LTS", marcaId: 42, categoryId: 999 },
  ]);
});

test("importInventory resuelve la categoría de respaldo una sola vez, aunque cree varios productos", async () => {
  let categoryResolutions = 0;

  const result = await importInventory(buildSampleWorkbook(), {
    findOrCreateMarca: async () => 42,
    findProductBySku: async () => null, // ningún sku existe: los 3 se crean
    updateProductMarca: async () => {},
    findOrCreateCategory: async () => {
      categoryResolutions++;
      return 999;
    },
    createProduct: async () => ({ id: 1 }),
  });

  assert.equal(result.created, 3);
  assert.equal(categoryResolutions, 1);
});

test("splitAmbiguousRows separa los sku repetidos dentro del mismo archivo", () => {
  // Caso real encontrado en el export del ERP: la referencia "1" corresponde
  // a la vez a un rastrillo y a un conector de cinta de riego — productos
  // sin ninguna relación entre sí.
  const rows = [
    { sku: "1", name: "RASTRILLO", marca: null, rowNumber: 490 },
    { sku: "2161", name: "CINTA GOTEO", marca: "ABC RIEGO", rowNumber: 772 },
    { sku: "1", name: "CONECTOR CINTA-CINTA", marca: "EUROPLAST", rowNumber: 4228 },
  ];

  const { safeRows, ambiguous } = splitAmbiguousRows(rows);

  assert.deepEqual(
    safeRows.map((r) => r.sku),
    ["2161"]
  );
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].sku, "1");
  assert.deepEqual(ambiguous[0].occurrences, [
    { name: "RASTRILLO", rowNumber: 490 },
    { name: "CONECTOR CINTA-CINTA", rowNumber: 4228 },
  ]);
});

test("importInventory nunca aplica un sku duplicado dentro del archivo, ni siquiera a costa de perder la actualización", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja1");
  sheet.addRow(["REFERENCIA", "DETALLE", "MARCA", "CANTIDAD"]);
  sheet.addRow(["1", "RASTRILLO", "", 3]);
  sheet.addRow(["2161", "CINTA GOTEO EN LINEA", "ABC RIEGO", 0]);
  sheet.addRow(["1", "CONECTOR CINTA-CINTA", "EUROPLAST", 10]);

  const updateCalls = [];
  const result = await importInventory(workbook, {
    findOrCreateMarca: async (name) => name,
    findProductBySku: async () => ({ id: 99 }), // existe para cualquier sku que se le pregunte
    updateProductMarca: async (productId, marcaId) => updateCalls.push({ productId, marcaId }),
  });

  assert.equal(result.updated, 1, "solo la fila con sku único (2161) se aplica");
  assert.equal(result.ambiguousSkus.length, 1);
  assert.equal(result.ambiguousSkus[0].sku, "1");
  assert.equal(result.ambiguousSkus[0].occurrences.length, 2);

  // Ningún llamado a updateProductMarca debe corresponder al sku "1": ni el
  // primero ni el segundo se aplican solos, para no arriesgar actualizar el
  // producto equivocado.
  assert.deepEqual(updateCalls, [{ productId: 99, marcaId: "ABC RIEGO" }]);
});

test("parseInventoryWorkbook lee cantidad y fecha de vencimiento cuando el archivo las trae", () => {
  const { rows } = parseInventoryWorkbook(buildWorkbookWithExpirations());

  assert.equal(rows.length, 3, "las 3 filas de producto; la de resumen del final no cuenta (sin REFERENCIA/DETALLE)");

  assert.equal(rows[0].sku, "2667");
  assert.equal(rows[0].expirationQty, 2);
  assert.deepEqual(rows[0].expirationDate, new Date(Date.UTC(2026, 7, 15)));

  // Sin columnas de vencimiento llenas para esa fila: null, no 0 ni undefined.
  assert.equal(rows[1].sku, "00006");
  assert.equal(rows[1].expirationQty, null);
  assert.equal(rows[1].expirationDate, null);

  assert.equal(rows[2].sku, "0898");
  assert.equal(rows[2].expirationQty, 5);
});

test("importInventory registra el lote (upsertBatch) solo en las filas que traen cantidad y fecha", async () => {
  const batchCalls = [];

  const result = await importInventory(buildWorkbookWithExpirations(), {
    findOrCreateMarca: async (name) => name,
    findProductBySku: async (sku) => ({ id: `product-${sku}` }), // los 3 sku "existen"
    updateProductMarca: async () => {},
    findOrCreateCategory: async () => {
      throw new Error("no debería hacer falta: todos los sku existen");
    },
    createProduct: async () => {
      throw new Error("no debería crear productos: todos los sku existen");
    },
    upsertBatch: async ({ productId, qty, expirationDate }) => {
      batchCalls.push({ productId, qty, expirationDate });
      return { id: batchCalls.length, created: true };
    },
  });

  assert.equal(result.updated, 3);
  assert.equal(result.batchesUpserted, 2, "solo 2667 y 0898 traen cantidad y fecha juntas");
  assert.deepEqual(batchCalls, [
    { productId: "product-2667", qty: 2, expirationDate: new Date(Date.UTC(2026, 7, 15)) },
    { productId: "product-0898", qty: 5, expirationDate: new Date(Date.UTC(2026, 11, 18)) },
  ]);
});

test("importInventory registra el lote también para un producto recién creado por la misma fila", async () => {
  const batchCalls = [];

  const result = await importInventory(buildWorkbookWithExpirations(), {
    findOrCreateMarca: async () => 42,
    findProductBySku: async () => null, // ningún sku existe todavía
    updateProductMarca: async () => {},
    findOrCreateCategory: async () => 999,
    createProduct: async ({ sku }) => ({ id: `nuevo-${sku}` }),
    upsertBatch: async ({ productId, qty, expirationDate }) => {
      batchCalls.push({ productId, qty, expirationDate });
      return { id: batchCalls.length, created: true };
    },
  });

  assert.equal(result.created, 3);
  assert.equal(result.batchesUpserted, 2);
  // El lote se registra con el id del producto recién creado, no con el sku.
  assert.equal(batchCalls[0].productId, "nuevo-2667");
  assert.equal(batchCalls[1].productId, "nuevo-0898");
});
