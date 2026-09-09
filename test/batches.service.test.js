const test = require("node:test");
const assert = require("node:assert/strict");

const { toDateOnlyString, daysUntil, tierOf } = require("../src/services/batches.service");

/**
 * Cálculo de urgencia de los lotes.
 *
 * Es la parte más delicada del módulo de vencimientos: si el cálculo de días
 * está mal, un producto vencido puede aparecer como "con tiempo" y nadie lo
 * revisa. Se prueba aislado de MySQL, con fechas fijas, para no depender de
 * qué día es hoy quien corre los tests.
 */

test("toDateOnlyString usa los componentes UTC, no la hora local", () => {
  assert.equal(toDateOnlyString(new Date(Date.UTC(2026, 7, 15))), "2026-08-15");
  assert.equal(toDateOnlyString("2026-12-01"), "2026-12-01");
});

test("toDateOnlyString rechaza una fecha inválida en vez de devolver 'Invalid Date'", () => {
  assert.throws(() => toDateOnlyString("no-es-una-fecha"), { statusCode: 400 });
});

test("daysUntil cuenta días de calendario, no horas exactas", () => {
  // "Hoy" a las 23:50 y el vencimiento es mañana a las 00:10: sigue siendo
  // "1 día", no "0 días" ni un número con fracción.
  const hoyTarde = new Date(2026, 8, 9, 23, 50);
  assert.equal(daysUntil("2026-09-10", hoyTarde), 1);

  const hoyTemprano = new Date(2026, 8, 9, 0, 5);
  assert.equal(daysUntil("2026-09-10", hoyTemprano), 1);
});

test("daysUntil da 0 el mismo día y negativo si ya venció", () => {
  const hoy = new Date(2026, 8, 9, 12, 0);
  assert.equal(daysUntil("2026-09-09", hoy), 0);
  assert.equal(daysUntil("2026-09-08", hoy), -1);
  assert.equal(daysUntil("2026-08-15", hoy), -25);
});

test("tierOf clasifica con el mismo criterio que el mockup original", () => {
  assert.equal(tierOf(-1), "vencido");
  assert.equal(tierOf(-100), "vencido");
  assert.equal(tierOf(0), "critico");
  assert.equal(tierOf(30), "critico");
  assert.equal(tierOf(31), "urgente");
  assert.equal(tierOf(60), "urgente");
  assert.equal(tierOf(61), "proximo");
  assert.equal(tierOf(90), "proximo");
  assert.equal(tierOf(91), "con_tiempo");
  assert.equal(tierOf(365), "con_tiempo");
});

test("caso real del archivo del ERP: ATA-K-DUO venció el 15-08-2026", () => {
  // Fila 871 del export real: fecha 2026-08-15, resaltada en amarillo por el
  // ERP porque ya pasó. "Hoy" en las pruebas es una fecha fija posterior.
  const hoy = new Date(2026, 8, 9); // 9 de septiembre de 2026
  const days = daysUntil("2026-08-15", hoy);
  assert.equal(days, -25);
  assert.equal(tierOf(days), "vencido");
});
