const test = require("node:test");
const assert = require("node:assert/strict");

const { resolvePagination, normalizeMarcaId } = require("../src/services/products.service");

/**
 * Paginación del listado de productos del panel.
 *
 * Con miles de productos posibles después de importar el ERP (ver
 * inventoryImport.service.js), lo que hay que garantizar acá no es el caso
 * feliz sino que ?page= y ?pageSize= —que llegan como texto desde el query
 * string, y pueden venir manipulados— nunca produzcan un OFFSET negativo ni
 * dejen pedir el catálogo entero de una sola página.
 */

test("valores por defecto sin argumentos", () => {
  const result = resolvePagination();
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 50);
  assert.equal(result.offset, 0);
});

test("calcula el offset correctamente para páginas siguientes", () => {
  assert.equal(resolvePagination({ page: 2, pageSize: 50 }).offset, 50);
  assert.equal(resolvePagination({ page: 3, pageSize: 20 }).offset, 40);
});

test("page y pageSize llegan como texto desde el query string", () => {
  const result = resolvePagination({ page: "3", pageSize: "25" });
  assert.equal(result.page, 3);
  assert.equal(result.pageSize, 25);
  assert.equal(result.offset, 50);
});

test("una página menor a 1, cero, negativa o no numérica cae en la página 1", () => {
  for (const bad of [0, -1, -100, "abc", null, undefined, NaN]) {
    assert.equal(resolvePagination({ page: bad }).page, 1, `page=${bad} debería dar 1`);
  }
});

test("pageSize tiene un tope: no se puede pedir el catálogo entero de un tirón", () => {
  assert.equal(resolvePagination({ pageSize: 999999 }).pageSize, 200);
  assert.equal(resolvePagination({ pageSize: "999999" }).pageSize, 200);
});

test("un pageSize inválido cae en el default, no en 0 ni en el tope", () => {
  for (const bad of [0, -5, "abc", null, undefined, NaN]) {
    assert.equal(resolvePagination({ pageSize: bad }).pageSize, 50, `pageSize=${bad} debería dar el default`);
  }
});

test("un pageSize con decimales se trunca a entero", () => {
  assert.equal(resolvePagination({ pageSize: 25.9 }).pageSize, 25);
});

/**
 * Marca elegida en el modal de producto.
 *
 * La marca es opcional, así que "vacío" y "un id que no sirve" son dos cosas
 * distintas: la primera es una elección legítima del administrador ("Sin
 * marca") y tiene que llegar a la base como NULL; la segunda es un error y
 * tiene que cortar con un 400. El `<select>` manda siempre texto, así que el
 * caso normal de un id válido también llega como cadena.
 */

test("sin marca elegida da null, no un error", () => {
  for (const vacio of ["", "   ", null, undefined]) {
    assert.equal(normalizeMarcaId(vacio), null, `${JSON.stringify(vacio)} debería dar null`);
  }
});

test("un id válido se normaliza a número, venga como número o como texto", () => {
  assert.equal(normalizeMarcaId(7), 7);
  assert.equal(normalizeMarcaId("7"), 7);
});

test("un id de marca inválido se rechaza con un 400", () => {
  for (const malo of [0, -3, "abc", 2.5, "1; DROP TABLE marcas"]) {
    assert.throws(
      () => normalizeMarcaId(malo),
      (err) => err.statusCode === 400,
      `${JSON.stringify(malo)} debería cortar con un 400`
    );
  }
});
