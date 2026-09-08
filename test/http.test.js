const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Tests de humo sobre la app real.
 *
 * Cubren solo lo que no toca MySQL: salud del proceso, la puerta del panel
 * y las cabeceras de seguridad. El catálogo y los pedidos dependen de la
 * base y se verifican contra el sitio ya desplegado (ver la Fase 5 de
 * DEPLOY.md); lo de acá tiene que poder correr en cualquier máquina, sin
 * base de datos levantada.
 *
 * Las variables se fijan ANTES de importar la app: dotenv no pisa lo que ya
 * está en process.env, así que esto gana sobre el .env de la máquina y los
 * tests dan igual en cualquier entorno.
 */
process.env.NODE_ENV = "test";
process.env.ADMIN_USER = "admin-de-prueba";
process.env.ADMIN_PASS = "clave-de-prueba";

const app = require("../src/app");
const pool = require("../src/config/db");

let baseUrl;
let server;

test.before(async () => {
  // Puerto 0: el sistema asigna uno libre, así los tests no chocan con el
  // servidor de desarrollo si está corriendo.
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // El pool nunca llegó a conectarse (ningún test consulta la base), pero
  // cerrarlo asegura que el proceso de test termine solo.
  await pool.end();
});

/** Credenciales en el formato que arma el navegador. */
function basicAuthHeader(user, pass) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

test("GET /health responde ok", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("GET /admin sin credenciales pide autenticación", async () => {
  const response = await fetch(`${baseUrl}/admin`);

  assert.equal(response.status, 401);
  // Sin esta cabecera el navegador no muestra el diálogo de acceso.
  assert.match(response.headers.get("www-authenticate") || "", /^Basic/);
});

test("GET /admin con credenciales incorrectas no entra", async () => {
  const wrong = [
    ["admin-de-prueba", "clave-equivocada"],
    ["usuario-equivocado", "clave-de-prueba"],
    ["", ""],
  ];

  for (const [user, pass] of wrong) {
    const response = await fetch(`${baseUrl}/admin`, {
      headers: { Authorization: basicAuthHeader(user, pass) },
    });
    assert.equal(response.status, 401, `no debería entrar con ${user}:${pass}`);
  }
});

test("GET /admin con las credenciales correctas sirve el panel", async () => {
  const response = await fetch(`${baseUrl}/admin`, {
    headers: { Authorization: basicAuthHeader("admin-de-prueba", "clave-de-prueba") },
  });

  assert.equal(response.status, 200);
  assert.match(await response.text(), /RolAgro/);
});

test("la API del panel también exige credenciales", async () => {
  // No alcanza con proteger el HTML: la API es la que expone y modifica los
  // datos. Si esto devolviera 200, el panel entero estaría abierto.
  for (const path of ["/admin/api/products", "/admin/api/orders", "/admin/api/categories"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 401, `${path} debería exigir credenciales`);
  }
});

test("una ruta inexistente bajo /api responde 404 en JSON", async () => {
  // El frontend hace res.json() sobre todo lo que recibe: un HTML de error
  // lo haría fallar de forma confusa.
  const response = await fetch(`${baseUrl}/api/no-existe`);

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.ok((await response.json()).error);
});

test("una ruta inexistente fuera de /api responde 404 de texto", async () => {
  const response = await fetch(`${baseUrl}/pagina-que-no-existe`);

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") || "", /text\/plain/);
});

test("las cabeceras de seguridad están puestas", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("strict-transport-security"));
  assert.ok(!response.headers.get("x-powered-by"), "no debe delatar Express");
});

test("la CSP permite los recursos que el sitio realmente usa", async () => {
  const response = await fetch(`${baseUrl}/health`);
  const csp = response.headers.get("content-security-policy") || "";

  // Bootstrap y sus iconos vienen de jsdelivr.
  assert.match(csp, /script-src[^;]*cdn\.jsdelivr\.net/);
  assert.match(csp, /style-src[^;]*cdn\.jsdelivr\.net/);
  // Las fotos de producto son URLs externas cargadas desde el panel: sin
  // "https:" el catálogo queda con todas las imágenes rotas.
  assert.match(csp, /img-src[^;]*https:/);
});
