const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

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
// Fija, para que los tokens de estos tests sean reproducibles. Sin esto,
// session.js genera una clave al azar por proceso (ver getSecret).
process.env.SESSION_SECRET = "clave-de-firma-solo-para-los-tests-01234";

const app = require("../src/app");
const pool = require("../src/config/db");

let baseUrl;
let server;
/** Cookie de sesión válida, para no repetir el login en cada test de abajo. */
let ADMIN_AUTH;

test.before(async () => {
  // Puerto 0: el sistema asigna uno libre, así los tests no chocan con el
  // servidor de desarrollo si está corriendo.
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  ADMIN_AUTH = { Cookie: cookieFrom(await postLogin("admin-de-prueba", "clave-de-prueba")) };
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // El pool nunca llegó a conectarse (ningún test consulta la base), pero
  // cerrarlo asegura que el proceso de test termine solo.
  await pool.end();
});

/**
 * Manda el formulario de login tal como lo haría el navegador y devuelve la
 * respuesta cruda (sin seguir el redirect, para poder mirarlo).
 */
function postLogin(user, pass) {
  return fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user, pass }),
    redirect: "manual",
  });
}

/** Extrae el par "nombre=valor" de un Set-Cookie, listo para reenviar. */
function cookieFrom(response) {
  const header = response.headers.get("set-cookie") || "";
  return header.split(";")[0];
}

test("GET /health responde ok", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("GET /admin sin sesión manda al login", async () => {
  const response = await fetch(`${baseUrl}/admin`, { redirect: "manual" });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/login");
});

test("GET /admin/login se sirve sin sesión", async () => {
  // Es la única ruta bajo /admin que no puede exigir sesión: si la exigiera,
  // no habría forma de conseguir una.
  const response = await fetch(`${baseUrl}/admin/login`);

  assert.equal(response.status, 200);
  assert.match(await response.text(), /<form[^>]+\/admin\/login/);
});

test("credenciales incorrectas no entregan sesión", async () => {
  const wrong = [
    ["admin-de-prueba", "clave-equivocada"],
    ["usuario-equivocado", "clave-de-prueba"],
    ["", ""],
  ];

  for (const [user, pass] of wrong) {
    const response = await postLogin(user, pass);
    assert.equal(response.headers.get("location"), "/admin/login?error=1");
    assert.equal(
      response.headers.get("set-cookie"),
      null,
      `no debería emitir cookie con ${user}:${pass}`
    );
  }
});

test("las credenciales correctas entregan una cookie de sesión endurecida", async () => {
  const response = await postLogin("admin-de-prueba", "clave-de-prueba");

  assert.equal(response.headers.get("location"), "/admin");

  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /^rolagro_admin=/);
  // HttpOnly: ningún script de la página puede leerla (ni uno inyectado).
  assert.match(setCookie, /HttpOnly/i);
  // SameSite=Strict: el navegador no la manda desde otro sitio. Es lo que
  // cierra el CSRF que reintrodujo pasar de Basic Auth a una cookie.
  assert.match(setCookie, /SameSite=Strict/i);
  // Path acotado: no viaja en las peticiones del catálogo público.
  assert.match(setCookie, /Path=\/admin/i);
  // Sin HTTPS no puede llevar Secure o la cookie no viajaría nunca; en
  // producción detrás de Nginx, req.secure la activa sola (ver session.js).
  assert.doesNotMatch(setCookie, /Secure/i);
});

test("con la cookie de sesión se entra al panel", async () => {
  const cookie = cookieFrom(await postLogin("admin-de-prueba", "clave-de-prueba"));
  const response = await fetch(`${baseUrl}/admin`, { headers: { Cookie: cookie } });

  assert.equal(response.status, 200);
  assert.match(await response.text(), /RolAgro/);
});

test("una cookie manipulada no sirve", async () => {
  const cookie = cookieFrom(await postLogin("admin-de-prueba", "clave-de-prueba"));
  const [name, token] = cookie.split("=");
  const [payload, signature] = token.split(".");

  const forged = [
    `${name}=${payload}.${signature.slice(0, -2)}xx`, // firma cambiada
    `${name}=${Buffer.from('{"fp":"x","exp":99999999999999}').toString("base64url")}.${signature}`, // payload cambiado
    `${name}=cualquier-cosa`,
    `${name}=`,
  ];

  for (const value of forged) {
    const response = await fetch(`${baseUrl}/admin`, {
      headers: { Cookie: value },
      redirect: "manual",
    });
    assert.equal(response.status, 302, `no debería aceptar: ${value.slice(0, 40)}`);
  }
});

test("cerrar sesión borra la cookie", async () => {
  const cookie = cookieFrom(await postLogin("admin-de-prueba", "clave-de-prueba"));
  const response = await fetch(`${baseUrl}/admin/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
    redirect: "manual",
  });

  assert.equal(response.headers.get("location"), "/admin/login?salida=1");
  // Se borra vaciándola y venciéndola: los atributos tienen que coincidir con
  // los de la emisión o el navegador la trataría como otra cookie distinta.
  assert.match(response.headers.get("set-cookie") || "", /^rolagro_admin=;/);
});

test("la API del panel también exige sesión", async () => {
  // No alcanza con proteger el HTML: la API es la que expone y modifica los
  // datos. Si esto devolviera 200, el panel entero estaría abierto.
  // Acá se responde 401 en JSON y no un redirect: del otro lado hay un fetch,
  // no una navegación, y admin.js traduce ese 401 en el salto al login.
  for (const path of [
    "/admin/api/products",
    "/admin/api/products/search",
    "/admin/api/products/1",
    "/admin/api/orders",
    "/admin/api/categories",
    "/admin/api/marcas",
    "/admin/api/marcas/1",
    "/admin/api/inventory/import",
    "/admin/api/products/1/publish",
    "/admin/api/batches",
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 401, `${path} debería exigir credenciales`);
  }
});

/** Arma un .xlsx en memoria con la forma del reporte real del ERP, sin filas de producto. */
async function buildEmptyInventoryFile() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja1");
  sheet.addRow(["NESTOR ROLANDO AVILA SANCHEZ"]);
  sheet.addRow(["REFERENCIA", "DETALLE", "MARCA", "CANTIDAD"]);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

test("POST /admin/api/inventory/import exige un archivo", async () => {
  const response = await fetch(`${baseUrl}/admin/api/inventory/import`, {
    method: "POST",
    headers: ADMIN_AUTH,
    body: new FormData(), // sin campo "file"
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /archivo/i);
});

test("POST /admin/api/inventory/import rechaza un archivo que no es .xlsx", async () => {
  const form = new FormData();
  form.append("file", new Blob(["no soy un excel"], { type: "text/plain" }), "inventario.csv");

  const response = await fetch(`${baseUrl}/admin/api/inventory/import`, {
    method: "POST",
    headers: ADMIN_AUTH,
    body: form,
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /\.xlsx/);
});

test("POST /admin/api/inventory/import procesa un archivo válido sin filas de producto", async () => {
  // Sin filas de producto no hay nada que buscar en la base: este caso
  // recorre multer + el controlador + el parser completo sin tocar MySQL,
  // igual que el resto de los tests de este archivo.
  const form = new FormData();
  form.append("file", await buildEmptyInventoryFile(), "inventario.xlsx");

  const response = await fetch(`${baseUrl}/admin/api/inventory/import`, {
    method: "POST",
    headers: ADMIN_AUTH,
    body: form,
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.totalDataRows, 0);
  assert.equal(body.updated, 0);
  assert.equal(body.created, 0);
  assert.deepEqual(body.createdProducts, []);
  assert.deepEqual(body.ambiguousSkus, []);
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

/* ==========================================================
   Rutas hostiles
   ==========================================================
   Nada de esto es un caso de uso: es lo que llega cuando alguien juega con
   la barra de direcciones o con curl. Casi todo ya se rechazaba antes de
   escribir estos tests; están para que un cambio futuro no lo afloje sin
   que nadie se entere.

   Ninguno toca MySQL, y no es casualidad: cada :id pasa por parseId ANTES
   de cualquier consulta, así que un id inválido corta en la validación.
   ========================================================== */

/** Todas las rutas del panel que reciben un :id, con su método. */
const RUTAS_CON_ID = [
  ["GET", (id) => `/admin/api/products/${id}`],
  ["PUT", (id) => `/admin/api/products/${id}`],
  ["DELETE", (id) => `/admin/api/products/${id}`],
  ["PATCH", (id) => `/admin/api/products/${id}/publish`],
  ["DELETE", (id) => `/admin/api/categories/${id}`],
  ["DELETE", (id) => `/admin/api/marcas/${id}`],
  ["DELETE", (id) => `/admin/api/batches/${id}`],
];

/** Lo que NO es un identificador, por más que venga en el lugar de uno. */
const IDS_INVALIDOS = [
  "-1",
  "0",
  "2.5",
  "abc",
  "null",
  "undefined",
  "1e3",
  "%20",
  "1%20OR%201=1",
  "%2e%2e%2f%2e%2e%2fetc%2fpasswd", // traversal codificado
];

test("ningún :id inválido llega a la base de datos", async () => {
  for (const [method, path] of RUTAS_CON_ID) {
    for (const id of IDS_INVALIDOS) {
      const response = await fetch(`${baseUrl}${path(id)}`, {
        method,
        headers: { ...ADMIN_AUTH, "Content-Type": "application/json" },
        body: method === "GET" || method === "DELETE" ? undefined : "{}",
      });

      assert.equal(
        response.status,
        400,
        `${method} ${path(id)} debería cortar con 400, respondió ${response.status}`
      );
      // El mensaje tiene que ser el de validación, no una fuga del motor.
      const { error } = await response.json();
      assert.match(error, /no es válido/, `${method} ${path(id)}: ${error}`);
    }
  }
});

test("un :id inválido se rechaza también sin sesión, y como 401", async () => {
  // El orden importa: primero se pregunta quién sos y después si el dato
  // sirve. Al revés, un anónimo podría distinguir ids válidos de inválidos.
  const response = await fetch(`${baseUrl}/admin/api/products/-1`);
  assert.equal(response.status, 401);
});

test("un cuerpo que no es JSON válido es culpa del cliente, no del servidor", async () => {
  const response = await fetch(`${baseUrl}/admin/api/categories`, {
    method: "POST",
    headers: { ...ADMIN_AUTH, "Content-Type": "application/json" },
    body: "{roto",
  });

  // Antes esto daba 500 y escribía un stack trace entero en el log del
  // servidor: cualquiera podía llenar `pm2 logs` mandando basura.
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /JSON/i);
});

test("un cuerpo gigante se rechaza con 413, no con 500", async () => {
  const response = await fetch(`${baseUrl}/admin/api/categories`, {
    method: "POST",
    headers: { ...ADMIN_AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x".repeat(200 * 1024) }), // el límite es 100kb
  });

  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /grande/i);
});

test("un producto sin nombre se rechaza antes de tocar la base", async () => {
  // validate() corre las reglas de texto y precio ANTES de comprobar la
  // categoría, que es la única que consulta MySQL.
  const invalidos = [
    { caso: "sin nombre", body: { name: "", price: 100, category_id: 1 } },
    { caso: "precio negativo", body: { name: "Abono", price: -5, category_id: 1 } },
    { caso: "precio no numérico", body: { name: "Abono", price: "gratis", category_id: 1 } },
    { caso: "imagen con javascript:", body: { name: "Abono", price: 100, category_id: 1, image_url: "javascript:alert(1)" } },
  ];

  for (const { caso, body } of invalidos) {
    const response = await fetch(`${baseUrl}/admin/api/products`, {
      method: "POST",
      headers: { ...ADMIN_AUTH, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, `debería rechazar: ${caso}`);
  }
});

test("una ruta inventada bajo /admin/api responde 404 en JSON, no el panel", async () => {
  const response = await fetch(`${baseUrl}/admin/api/no-existe`, { headers: ADMIN_AUTH });

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
});

test("los archivos del servidor no se alcanzan desde la carpeta pública", async () => {
  // express.static ya normaliza y bloquea esto, pero el .env vive un nivel
  // arriba de public/ y es justo lo que alguien intentaría leer.
  const intentos = [
    "/..%2f.env",
    "/css/..%2f..%2f.env",
    "/%2e%2e%2f%2e%2e%2fpackage.json",
    "/..%5c..%5c.env", // separador de Windows
  ];

  for (const path of intentos) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 404, `${path} no debería servir nada`);
    const cuerpo = await response.text();
    assert.doesNotMatch(cuerpo, /DB_PASSWORD|ADMIN_PASS|SESSION_SECRET/, `${path} filtró el .env`);
  }
});

test("un método que la ruta no declara no cae en otra ruta parecida", async () => {
  // El riesgo real: que un método no declarado se cuele en un handler
  // vecino (ej. un DELETE en /api/products atendido por el GET).
  const casos = [
    ["DELETE", "/api/products"],
    ["PUT", "/api/categories"],
    ["POST", "/api/config"],
    ["GET", "/api/orders"], // el checkout es solo POST
  ];

  for (const [method, path] of casos) {
    const response = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(response.status, 404, `${method} ${path} debería ser 404`);
  }
});
