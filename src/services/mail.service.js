const transporter = require("../config/mailer");
const { formatCOP, escapeHtml } = require("../utils/format");

/**
 * Servicio de correo: arma y envía la notificación de pedido a la empresa.
 * Es el único módulo que habla con Nodemailer.
 */

/**
 * Construye el HTML del correo con los datos del pedido.
 *
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
 * Envía la notificación del pedido y devuelve si salió o no.
 *
 * A propósito NO propaga el error: el correo es un aviso, no la venta. El
 * pedido ya está guardado en la base cuando se llama a esta función, así que
 * un fallo de SMTP se registra y se reporta como `false` para marcarlo en la
 * tabla, pero nunca debe tumbar la petición del cliente.
 */
async function sendOrderNotification({ orderId, name, phone, items, total }) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.MAIL_TO,
      subject: `Nuevo pedido #${orderId} de ${name} - RolAgro`,
      html: buildOrderEmailHtml({ name, phone, items, total }),
    });
    return true;
  } catch (err) {
    console.error(
      `El pedido #${orderId} se guardó, pero falló el envío del correo:`,
      err
    );
    return false;
  }
}

module.exports = { sendOrderNotification, buildOrderEmailHtml };
