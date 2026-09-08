const test = require("node:test");
const assert = require("node:assert/strict");

const { validateCustomer } = require("../src/services/orders.service");

/**
 * Validación de los datos del cliente en el checkout.
 *
 * Es la frontera donde entra texto escrito por cualquiera desde el
 * formulario público, así que lo que se prueba acá no es "que funcione el
 * caso feliz" sino que lo que no debe pasar, no pase.
 */

test("acepta un pedido normal y devuelve los datos limpios", () => {
  const result = validateCustomer({
    name: "  María Pérez  ",
    phone: " +57 300 123 4567 ",
  });

  assert.equal(result.name, "María Pérez");
  assert.equal(result.phone, "+57 300 123 4567");
});

test("quita los saltos de línea del nombre y del teléfono", () => {
  // Un \r\n en estos campos termina en el asunto y el cuerpo del correo:
  // es el vector clásico de inyección de cabeceras.
  const result = validateCustomer({
    name: "Ana\r\nBcc: otro@ejemplo.com",
    phone: "3001234567\n",
  });

  assert.ok(!result.name.includes("\n"), "el nombre no debe tener saltos");
  assert.ok(!result.name.includes("\r"), "el nombre no debe tener retornos");
  assert.equal(result.phone, "3001234567");
});

test("rechaza el nombre vacío o solo con espacios", () => {
  assert.throws(() => validateCustomer({ name: "", phone: "3001234567" }), {
    statusCode: 400,
  });
  assert.throws(() => validateCustomer({ name: "   ", phone: "3001234567" }), {
    statusCode: 400,
  });
});

test("rechaza un nombre de más de 100 caracteres", () => {
  assert.throws(
    () => validateCustomer({ name: "a".repeat(101), phone: "3001234567" }),
    { statusCode: 400 }
  );
});

test("acepta un nombre de exactamente 100 caracteres", () => {
  const result = validateCustomer({
    name: "a".repeat(100),
    phone: "3001234567",
  });
  assert.equal(result.name.length, 100);
});

test("rechaza teléfonos que no son teléfonos", () => {
  const invalidPhones = [
    "", // vacío
    "123", // muy corto
    "1".repeat(21), // muy largo
    "no-es-un-telefono",
    "300123456<script>",
    "300 123 4567; DROP TABLE orders",
  ];

  for (const phone of invalidPhones) {
    assert.throws(
      () => validateCustomer({ name: "Ana", phone }),
      { statusCode: 400 },
      `debería rechazar el teléfono: ${JSON.stringify(phone)}`
    );
  }
});

test("acepta los formatos de teléfono que usa la gente de verdad", () => {
  const validPhones = [
    "3001234567",
    "+57 300 123 4567",
    "(300) 123-4567",
    "300-123-4567",
  ];

  for (const phone of validPhones) {
    assert.doesNotThrow(
      () => validateCustomer({ name: "Ana", phone }),
      `debería aceptar el teléfono: ${phone}`
    );
  }
});

test("no explota si faltan los campos", () => {
  // El cuerpo de la petición lo arma el cliente: puede llegar cualquier cosa.
  assert.throws(() => validateCustomer({}), { statusCode: 400 });
  assert.throws(() => validateCustomer({ name: null, phone: null }), {
    statusCode: 400,
  });
});
