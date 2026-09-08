const pool = require("../config/db");
const productsService = require("./products.service");
const mailService = require("./mail.service");
const whatsappService = require("./whatsapp.service");
const AppError = require("../utils/AppError");

/**
 * Servicio de pedidos.
 *
 * Reúne las reglas del checkout de invitado: qué datos son válidos, cuánto
 * cuesta realmente el pedido y cómo se guarda. `placeOrder` es el caso de uso
 * completo (guardar + notificar); el controlador solo le pasa el cuerpo de la
 * petición y devuelve el resultado.
 */

const MAX_ITEMS = 50; // Productos distintos por pedido.
const MAX_QTY = 999; // Unidades por producto.
const MAX_RECENT_ORDERS = 100;

/**
 * Valida los datos del cliente.
 * Se quitan los saltos de línea: además de ensuciar el correo, podrían usarse
 * para inyectar cabeceras en el asunto del mensaje.
 */
function validateCustomer({ name, phone }) {
  const cleanName = String(name || "").replace(/[\r\n]/g, " ").trim();
  const cleanPhone = String(phone || "").replace(/[\r\n]/g, " ").trim();

  if (!cleanName) {
    throw AppError.badRequest("El nombre es requerido.");
  }
  if (cleanName.length > 100) {
    throw AppError.badRequest("El nombre no puede superar los 100 caracteres.");
  }
  if (!cleanPhone) {
    throw AppError.badRequest("El teléfono es requerido.");
  }
  // Acepta dígitos, espacios, guiones, paréntesis y un "+" inicial.
  if (!/^\+?[\d\s\-()]{7,20}$/.test(cleanPhone)) {
    throw AppError.badRequest(
      "El teléfono no es válido. Debe tener entre 7 y 20 dígitos."
    );
  }

  return { name: cleanName, phone: cleanPhone };
}

/**
 * Recalcula el pedido contra los precios reales de la base.
 *
 * Nunca se confía en los precios que manda el cliente: solo se le cree qué
 * productos quiere y cuántas unidades, y aun eso se acota.
 */
async function buildOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw AppError.badRequest("El carrito está vacío.");
  }
  if (items.length > MAX_ITEMS) {
    throw AppError.badRequest("El pedido tiene demasiados productos distintos.");
  }

  const productIds = items.map((item) => item && item.productId);
  const productsById = await productsService.findByIds(productIds);

  if (productsById.size !== new Set(productIds.map(Number)).size) {
    throw AppError.badRequest("Uno o más productos del carrito ya no existen.");
  }

  let total = 0;
  const orderItems = items.map((item) => {
    const product = productsById.get(Number(item.productId));

    // La cantidad se acota entre 1 y 999: evita pedidos con cantidades
    // absurdas o negativas enviadas manipulando la petición.
    const rawQty = Math.floor(Number(item.qty));
    const qty = Number.isFinite(rawQty) ? Math.min(Math.max(rawQty, 1), MAX_QTY) : 1;
    const subtotal = Number(product.price) * qty;
    total += subtotal;

    return {
      productId: product.id,
      name: product.name,
      price: Number(product.price),
      qty,
      subtotal,
    };
  });

  return { items: orderItems, total };
}

/**
 * Guarda el pedido y su detalle dentro de una transacción: o queda la
 * cabecera con todos sus items, o no queda nada.
 */
async function save({ name, phone, items, total }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      "INSERT INTO orders (customer_name, customer_phone, total) VALUES (?, ?, ?)",
      [name, phone, total]
    );
    const orderId = result.insertId;

    // Un solo INSERT con todos los items en lugar de uno por producto.
    const placeholders = items.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const values = items.flatMap((item) => [
      orderId,
      item.productId,
      item.name,
      item.price,
      item.qty,
      item.subtotal,
    ]);

    await connection.query(
      `INSERT INTO order_items
         (order_id, product_id, product_name, unit_price, qty, subtotal)
       VALUES ${placeholders}`,
      values
    );

    await connection.commit();
    return orderId;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/** Marca si la notificación por correo llegó a salir. */
async function markEmailStatus(orderId, sent) {
  await pool.query("UPDATE orders SET email_status = ? WHERE id = ?", [
    sent ? "enviado" : "fallido",
    orderId,
  ]);
}

/**
 * Caso de uso completo del checkout: valida, cobra al precio real, guarda y
 * notifica.
 *
 * El orden importa. El pedido se guarda ANTES de notificar, porque si el
 * correo falla la venta no se puede perder: queda registrada y marcada como
 * 'fallido' para atenderla a mano.
 */
async function placeOrder({ name, phone, items }) {
  const customer = validateCustomer({ name, phone });
  const { items: orderItems, total } = await buildOrderItems(items);

  const orderData = { ...customer, items: orderItems, total };
  const orderId = await save(orderData);

  const emailSent = await mailService.sendOrderNotification({
    orderId,
    ...orderData,
  });
  await markEmailStatus(orderId, emailSent);

  return {
    orderId,
    total,
    whatsappLink: whatsappService.buildOrderLink(orderData),
  };
}

/**
 * Últimos pedidos con su detalle, para el panel.
 *
 * Se consulta el detalle aparte y se anida en JS en lugar de hacer un JOIN:
 * evita repetir los datos de la cabecera en cada fila de item.
 */
async function findRecent(limit = MAX_RECENT_ORDERS) {
  const [orders] = await pool.query(
    `SELECT id, customer_name, customer_phone, total, email_status, created_at
     FROM orders
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    // Se fuerza a entero: LIMIT no admite parámetros de tipo texto y el valor
    // nunca debe llegar crudo a la consulta.
    [Math.max(1, Math.floor(Number(limit)) || MAX_RECENT_ORDERS)]
  );

  if (orders.length === 0) return [];

  const orderIds = orders.map((order) => order.id);
  const placeholders = orderIds.map(() => "?").join(",");
  const [items] = await pool.query(
    `SELECT order_id, product_name, unit_price, qty, subtotal
     FROM order_items
     WHERE order_id IN (${placeholders})
     ORDER BY id`,
    orderIds
  );

  const itemsByOrder = new Map(orderIds.map((id) => [id, []]));
  items.forEach((item) => itemsByOrder.get(item.order_id).push(item));

  return orders.map((order) => ({ ...order, items: itemsByOrder.get(order.id) }));
}

module.exports = { placeOrder, findRecent };
