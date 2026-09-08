/**
 * Utilidades de formato compartidas por los servicios del servidor.
 * (El frontend tiene sus propias copias en public/js: no comparten módulos
 * porque el navegador no carga CommonJS.)
 */

/** Formatea un valor como precio en pesos colombianos: 45000 -> "$45.000". */
const formatCOP = (value) =>
  "$" + Number(value).toLocaleString("es-CO", { maximumFractionDigits: 0 });

/**
 * Escapa caracteres con significado en HTML.
 *
 * Se usa antes de meter cualquier dato en el correo del pedido: el nombre y
 * el teléfono los escribe el cliente en el formulario, así que insertarlos
 * crudos permitiría inyectar etiquetas o scripts en el mensaje que recibe la
 * empresa.
 */
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

module.exports = { formatCOP, escapeHtml };
