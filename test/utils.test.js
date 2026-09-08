const test = require("node:test");
const assert = require("node:assert/strict");

const { escapeHtml, formatCOP } = require("../src/utils/format");
const { parseId } = require("../src/utils/validate");

/** Escape de HTML: lo que evita que el correo del pedido sea inyectable. */

test("escapeHtml neutraliza los caracteres con significado en HTML", () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
  );
  assert.equal(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
  assert.equal(escapeHtml("O'Brien"), "O&#39;Brien");
});

test("escapeHtml escapa el & primero, sin doble escape", () => {
  // Si el & se escapara al final, "&lt;" terminaría como "&amp;lt;".
  assert.equal(escapeHtml("<"), "&lt;");
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("escapeHtml no rompe con null ni undefined", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(0), "0");
});

/** Formato de precios. */

test("formatCOP arma el precio en pesos colombianos", () => {
  assert.equal(formatCOP(45000), "$45.000");
  assert.equal(formatCOP(0), "$0");
});

test("formatCOP no muestra decimales", () => {
  assert.equal(formatCOP(1234.56), "$1.235");
});

/** parseId: se usa antes de tocar la base con cualquier id externo. */

test("parseId acepta enteros positivos, vengan como número o texto", () => {
  assert.equal(parseId(5), 5);
  assert.equal(parseId("42"), 42);
});

test("parseId rechaza cualquier cosa que no sea un entero positivo", () => {
  const invalid = [0, -1, 1.5, "abc", "", null, undefined, {}, [], NaN];

  for (const value of invalid) {
    assert.throws(
      () => parseId(value),
      { statusCode: 400 },
      `debería rechazar: ${JSON.stringify(value)}`
    );
  }
});
