const test = require("node:test");
const assert = require("node:assert/strict");

const { findProblems } = require("../src/config/env");

/**
 * Validación del .env.
 *
 * Lo que se prueba acá es lo que evita un deploy roto en silencio: que un
 * .env incompleto o copiado sin completar sea detectado antes de que un
 * cliente haga un pedido que nadie recibe.
 */

/** Un entorno completo y válido, base para las variantes de cada test. */
function validEnv(overrides = {}) {
  return {
    DB_USER: "rolagro",
    DB_PASSWORD: "una-clave-real",
    DB_NAME: "rolagro_db",
    SMTP_USER: "ventas@rolagro.com",
    SMTP_PASS: "abcd efgh ijkl mnop",
    MAIL_TO: "duenia@rolagro.com",
    ADMIN_USER: "admin",
    ADMIN_PASS: "una-clave-larga-y-propia",
    SESSION_SECRET: "3XxKq7mZp2vRt8sLbN4wYc6hJf0dQaEu",
    WHATSAPP_NUMBER: "573001234567",
    ...overrides,
  };
}

test("un entorno completo no reporta problemas", () => {
  assert.deepEqual(findProblems(validEnv()), []);
});

test("detecta cada variable faltante", () => {
  const required = [
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
    "SMTP_USER",
    "SMTP_PASS",
    "MAIL_TO",
    "ADMIN_USER",
    "ADMIN_PASS",
    "SESSION_SECRET",
    "WHATSAPP_NUMBER",
  ];

  for (const name of required) {
    const problems = findProblems(validEnv({ [name]: "" }));
    assert.equal(problems.length, 1, `${name} debería reportar un problema`);
    assert.match(problems[0], new RegExp(`^${name} falta`));
  }
});

test("una variable con solo espacios cuenta como faltante", () => {
  const problems = findProblems(validEnv({ ADMIN_PASS: "   " }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^ADMIN_PASS falta/);
});

test("detecta los valores de ejemplo sin completar", () => {
  // El más grave: dejar la contraseña del panel de .env.example.
  const problems = findProblems(
    validEnv({ ADMIN_PASS: "cambia_esta_clave" })
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ADMIN_PASS todavía tiene el valor de ejemplo/);
});

test("rechaza una contraseña de panel demasiado corta", () => {
  // El caso real que motivó el chequeo: "admin123" es la clave de desarrollo
  // de este repo. No está en .env.example, así que la lista de placeholders
  // no la ve, y hasta acá pasaba a producción sin que nada se quejara.
  const problems = findProblems(validEnv({ ADMIN_PASS: "admin123" }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^ADMIN_PASS tiene un formato inválido/);
  // El mensaje tiene que decir cuánto falta: se lee en `pm2 logs` con el
  // sitio caído, sin el código a mano.
  assert.match(problems[0], /12 caracteres/);
});

test("el mínimo de la contraseña del panel corta justo en 12 caracteres", () => {
  assert.equal(findProblems(validEnv({ ADMIN_PASS: "clave-de-11" })).length, 1);
  assert.deepEqual(findProblems(validEnv({ ADMIN_PASS: "clave-de-12x" })), []);
});

test("rechaza números de WhatsApp que romperían el enlace wa.me", () => {
  // wa.me solo acepta dígitos: cualquiera de estos genera un enlace muerto
  // sin dar ningún error visible.
  const invalid = ["+573001234567", "300 123 4567", "300-123-4567", "abc", "123"];

  for (const value of invalid) {
    const problems = findProblems(validEnv({ WHATSAPP_NUMBER: value }));
    assert.equal(
      problems.length,
      1,
      `debería rechazar el número: ${JSON.stringify(value)}`
    );
    assert.match(problems[0], /^WHATSAPP_NUMBER tiene un formato inválido/);
  }
});

test("rechaza correos sin arroba", () => {
  const problems = findProblems(validEnv({ MAIL_TO: "pedidos-arroba-rolagro" }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^MAIL_TO tiene un formato inválido/);
});

test("reporta todos los problemas juntos, no solo el primero", () => {
  // Importa para el deploy: que la dueña vea de una todo lo que falta,
  // en vez de arreglar de a uno y reintentar.
  const problems = findProblems({});
  assert.equal(problems.length, 10);
});

test("rechaza una clave de firma de sesión demasiado corta", () => {
  // Una clave adivinable acá es tan grave como la contraseña: con ella se
  // puede fabricar una cookie de sesión válida sin saber la contraseña.
  const problems = findProblems(validEnv({ SESSION_SECRET: "corta" }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^SESSION_SECRET tiene un formato inválido/);
  // El mensaje trae el comando que la genera: se lee durante un deploy.
  assert.match(problems[0], /openssl rand -base64 32/);
});
