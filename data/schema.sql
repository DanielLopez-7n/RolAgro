-- RolAgro — esquema de base de datos
-- Productos y categorías del catálogo, más el historial de pedidos.
-- No hay tabla de usuarios: el checkout es de invitado.

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  image_url VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Pedidos recibidos desde el checkout de invitado.
-- Se guardan ANTES de enviar el correo: si el correo falla, la venta no se
-- pierde y queda marcada en `email_status` para reenviarla o atenderla a mano.
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  email_status ENUM('enviado', 'fallido') NOT NULL DEFAULT 'fallido',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Detalle de cada pedido.
-- `product_name` y `unit_price` se copian a propósito: el pedido es un
-- documento histórico y debe seguir leyéndose aunque el producto se renombre,
-- cambie de precio o se borre desde el panel (por eso el FK es SET NULL).
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NULL,
  product_name VARCHAR(150) NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  qty INT NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);
