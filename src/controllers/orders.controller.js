const pool = require("../config/db");
const transporter = require("../config/mailer");

const formatCOP = (value) =>
  "$" + Number(value).toLocaleString("es-CO", { maximumFractionDigits: 0 });

/**
 * Escapa caracteres con significado en HTML.
 * El nombre y el teléfono los escribe el cliente en el formulario, así que
 * NUNCA deben insertarse crudos en el HTML del correo: alguien podría enviar
 * etiquetas o scripts que se inyectarían en el mensaje que recibe la empresa.
 */
const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Construye el HTML del correo con los datos del pedido.
 * Nota: todavía no existe un archivo de logo real de RolAgro, así que se usa
 * un encabezado con texto/estilo como placeholder. Cuando exista un logo
 * definitivo (ej. public/images/logo.png), se puede reemplazar este bloque por
 * un <img src="cid:rolagro-logo"> y adjuntar el archivo en `sendMail`
 * (attachments: [{ filename: 'logo.png', path: '...', cid: 'rolagro-logo' }]).
 */
function buildOrderEmailHtml({ name, phone, items, total }) {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e0e0e0;">${escapeHtml(item.name)}</td>
          <td style="padding:8px;border-bottom:1px solid #e0e0e0;text-align:center;">${item.qty}</td>
          <td style="padding:8px;border-bottom:1px solid #e0e0e0;text-align:right;">${formatCOP(item.price)}</td>
          <td style="padding:8px;border-bottom:1px solid #e0e0e0;text-align:right;">${formatCOP(item.subtotal)}</td>
        </tr>`
    )
    .join("");

  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:#1b4d1e;color:#fff;padding:20px;text-align:center;">
      <h1 style="margin:0;font-size:22px;">🌱 RolAgro</h1>
      <p style="margin:4px 0 0;font-size:13px;">Nuevo pedido recibido desde el sitio web</p>
    </div>
    <div style="padding:20px;border:1px solid #e0e0e0;border-top:none;">
      <h2 style="font-size:16px;color:#1b4d1e;">Datos del cliente</h2>
      <p style="margin:4px 0;"><strong>Nombre:</strong> ${escapeHtml(name)}</p>
      <p style="margin:4px 0 16px;"><strong>Teléfono:</strong> ${escapeHtml(phone)}</p>

      <h2 style="font-size:16px;color:#1b4d1e;">Detalle del pedido</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f2f2f2;">
            <th style="padding:8px;text-align:left;">Producto</th>
            <th style="padding:8px;text-align:center;">Cant.</th>
            <th style="padding:8px;text-align:right;">Precio</th>
            <th style="padding:8px;text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="text-align:right;margin-top:16px;font-size:18px;font-weight:bold;color:#1b4d1e;">
        Total: ${formatCOP(total)}
      </div>
    </div>
  </div>`;
}

/**
 * Arma el texto del mensaje de WhatsApp (URL-encoded por wa.me).
 */
function buildWhatsappMessage({ name, items, total }) {
  const lines = [
    `Hola RolAgro, soy ${name}. Quiero confirmar mi pedido:`,
    ...items.map((item) => `- ${item.name} x${item.qty}`),
    `Total: ${formatCOP(total)}`,
  ];
  return lines.join("\n");
}

// POST /api/orders
async function createOrder(req, res) {
  try {
    const { name, phone, items } = req.body || {};

    // Se quitan saltos de línea: además de ensuciar el correo, podrían
    // usarse para inyectar cabeceras en el asunto del mensaje.
    const cleanName = String(name || "").replace(/[\r\n]/g, " ").trim();
    const cleanPhone = String(phone || "").replace(/[\r\n]/g, " ").trim();

    if (!cleanName) {
      return res.status(400).json({ error: "El nombre es requerido." });
    }
    if (cleanName.length > 100) {
      return res
        .status(400)
        .json({ error: "El nombre no puede superar los 100 caracteres." });
    }
    if (!cleanPhone) {
      return res.status(400).json({ error: "El teléfono es requerido." });
    }
    // Acepta dígitos, espacios, guiones, paréntesis y un "+" inicial.
    if (!/^\+?[\d\s\-()]{7,20}$/.test(cleanPhone)) {
      return res.status(400).json({
        error: "El teléfono no es válido. Debe tener entre 7 y 20 dígitos.",
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "El carrito está vacío." });
    }
    if (items.length > 50) {
      return res
        .status(400)
        .json({ error: "El pedido tiene demasiados productos distintos." });
    }

    // Se vuelven a consultar los precios reales en MySQL: nunca se confía
    // en los precios que pueda enviar el cliente.
    const productIds = items.map((item) => item.productId);
    const placeholders = productIds.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT id, name, price FROM products WHERE id IN (${placeholders})`,
      productIds
    );

    if (rows.length !== new Set(productIds).size) {
      return res
        .status(400)
        .json({ error: "Uno o más productos del carrito ya no existen." });
    }

    const productsById = new Map(rows.map((p) => [p.id, p]));

    let total = 0;
    const orderItems = items.map((item) => {
      const product = productsById.get(item.productId);
      // La cantidad se acota entre 1 y 999: evita pedidos con cantidades
      // absurdas o negativas enviadas manipulando la petición.
      const rawQty = Math.floor(Number(item.qty));
      const qty = Number.isFinite(rawQty) ? Math.min(Math.max(rawQty, 1), 999) : 1;
      const subtotal = Number(product.price) * qty;
      total += subtotal;
      return {
        name: product.name,
        price: Number(product.price),
        qty,
        subtotal,
      };
    });

    const orderData = {
      name: cleanName,
      phone: cleanPhone,
      items: orderItems,
      total,
    };

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.MAIL_TO,
      subject: `Nuevo pedido de ${orderData.name} - RolAgro`,
      html: buildOrderEmailHtml(orderData),
    });

    const whatsappNumber = process.env.WHATSAPP_NUMBER || "";
    const whatsappMessage = buildWhatsappMessage(orderData);
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
      whatsappMessage
    )}`;

    res.json({ success: true, total, whatsappLink });
  } catch (err) {
    console.error("Error al procesar el pedido:", err);
    res
      .status(500)
      .json({ error: "No se pudo enviar el pedido. Intenta nuevamente." });
  }
}

module.exports = { createOrder };
