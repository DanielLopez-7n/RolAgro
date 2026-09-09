-- RolAgro — esquema de base de datos
-- Productos y categorías del catálogo, más el historial de pedidos.
-- No hay tabla de usuarios: el checkout es de invitado.

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

-- Fabricante/marca del producto (ej. SYNGENTA, BAYER). Es independiente de
-- `categories` (que agrupa por rubro, ej. "Fungicidas"): un producto tiene
-- una categoría y, si aplica, una marca. Se llena sobre todo por la
-- importación desde el ERP de la tienda física (ver inventoryImport.service.js);
-- muchos productos genéricos (fertilizantes sin marca comercial) no tienen una.
CREATE TABLE IF NOT EXISTS marcas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  marca_id INT NULL,
  -- Código de referencia del ERP de la tienda física (columna REFERENCIA del
  -- export). Nulo para productos que solo existen en el catálogo web. Es la
  -- clave que usa la importación para emparejar cada fila del Excel con su
  -- producto, en lugar de emparejar por nombre (frágil ante renombres/typos).
  sku VARCHAR(20) NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  image_url VARCHAR(255),
  -- Todo producto cargado a mano desde el panel nace publicado (por eso el
  -- DEFAULT 1: un alta existente no cambia de comportamiento). En 0 solo
  -- para los productos que crea la importación del ERP (ver
  -- inventoryImport.service.js): ese archivo no trae precio ni categoría
  -- reales, así que el producto se crea como borrador — invisible en
  -- /api/products — hasta que alguien le cargue un precio real desde el panel.
  published TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (marca_id) REFERENCES marcas(id)
);

-- Lotes con fecha de vencimiento de un producto.
-- Un producto puede tener varios lotes activos (distintas compras, distintas
-- fechas). Se llenan a mano desde el panel o por la importación del ERP,
-- que trae "cantidad próxima/vencida" y "fecha" para los productos que el
-- ERP ya trackea así (ver inventoryImport.service.js). ON DELETE CASCADE a
-- propósito, a diferencia de order_items: un lote es estado de inventario
-- actual, no un documento histórico — si el producto se borra, su lote no
-- tiene sentido por separado.
CREATE TABLE IF NOT EXISTS product_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  qty INT NOT NULL,
  expiration_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
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
