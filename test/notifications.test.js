const test = require("node:test");
const assert = require("node:assert/strict");

const whatsappService = require("../src/services/whatsapp.service");
const { buildOrderEmailHtml } = require("../src/services/mail.service");

/**
 * Los dos avisos que salen de un pedido: el enlace de WhatsApp que se le
 * muestra al cliente y el correo que recibe la empresa.
 */

const sampleOrder = {
  name: "Ana Gómez",
  phone: "3001234567",
  items: [
    { name: "Fertilizante", qty: 2, price: 45000, subtotal: 90000 },
    { name: "Semillas", qty: 1, price: 12000, subtotal: 12000 },
  ],
  total: 102000,
};

test("el enlace de WhatsApp usa el número configurado", () => {
  process.env.WHATSAPP_NUMBER = "573001234567";
  const link = whatsappService.buildOrderLink(sampleOrder);

  assert.ok(link.startsWith("https://wa.me/573001234567?text="));
});

test("el mensaje de WhatsApp va codificado para URL", () => {
  process.env.WHATSAPP_NUMBER = "573001234567";
  const link = whatsappService.buildOrderLink(sampleOrder);

  // Sin codificar, los saltos de línea y los espacios cortarían la URL.
  assert.ok(!link.includes("\n"), "la URL no debe tener saltos de línea");
  assert.ok(!link.includes(" "), "la URL no debe tener espacios");

  const message = decodeURIComponent(link.split("?text=")[1]);
  assert.match(message, /Ana Gómez/);
  assert.match(message, /Fertilizante x2/);
  assert.match(message, /Total: \$102\.000/);
});

test("el correo del pedido escapa lo que escribió el cliente", () => {
  // El nombre y el teléfono salen del formulario público: si entraran
  // crudos, el correo que abre la dueña sería inyectable.
  const html = buildOrderEmailHtml({
    ...sampleOrder,
    name: '<img src=x onerror="alert(1)">',
    phone: "300<script>",
  });

  assert.ok(!html.includes("<img src=x"), "no debe quedar la etiqueta cruda");
  assert.ok(!html.includes("300<script>"), "no debe quedar el script crudo");
  assert.match(html, /&lt;img src=x/);
});

test("el correo escapa también los nombres de producto", () => {
  // Vienen de la base, pero los carga la dueña desde el panel: si algún día
  // pega un nombre con comillas o signos, el correo no debe romperse.
  const html = buildOrderEmailHtml({
    ...sampleOrder,
    items: [{ name: 'Abono "premium" & Cía', qty: 1, price: 1000, subtotal: 1000 }],
  });

  assert.match(html, /Abono &quot;premium&quot; &amp; Cía/);
});

test("el correo incluye el detalle y el total del pedido", () => {
  const html = buildOrderEmailHtml(sampleOrder);

  assert.match(html, /Ana Gómez/);
  assert.match(html, /3001234567/);
  assert.match(html, /Fertilizante/);
  assert.match(html, /Semillas/);
  assert.match(html, /\$102\.000/);
});
