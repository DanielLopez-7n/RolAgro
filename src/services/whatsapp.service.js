const { formatCOP } = require("../utils/format");

/**
 * Servicio de WhatsApp: arma los enlaces wa.me que abren el chat con la
 * empresa. No hace peticiones a ninguna parte, solo construye la URL.
 */

/** Número de la empresa, en el formato internacional que exige wa.me. */
function getNumber() {
  return process.env.WHATSAPP_NUMBER || "";
}

/** Texto del mensaje con el resumen del pedido. */
function buildOrderMessage({ name, items, total }) {
  const lines = [
    `Hola RolAgro, soy ${name}. Quiero confirmar mi pedido:`,
    ...items.map((item) => `- ${item.name} x${item.qty}`),
    `Total: ${formatCOP(total)}`,
  ];
  return lines.join("\n");
}

/** Enlace listo para abrir el chat con el pedido ya escrito. */
function buildOrderLink(order) {
  const message = encodeURIComponent(buildOrderMessage(order));
  return `https://wa.me/${getNumber()}?text=${message}`;
}

module.exports = { getNumber, buildOrderMessage, buildOrderLink };
