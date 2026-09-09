-- Migración puntual: agrega `marcas`, `product_batches` y las columnas
-- `sku`/`marca_id`/`published` de `products` a una base de datos que ya
-- existía ANTES de este cambio.
--
-- `data/schema.sql` ya describe estas tablas con CREATE TABLE IF NOT EXISTS,
-- así que una base nueva (`npm run db:init` desde cero) las recibe sin este
-- archivo. Este script es solo para no tener que borrar una base de datos de
-- desarrollo que ya tenía datos de prueba cargados.
--
-- Uso (una sola vez, por base de datos existente):
--   mysql -u root -p rolagro_db < data/migrations/2026-09-09_marcas_y_sku.sql

CREATE TABLE IF NOT EXISTS marcas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

-- ADD COLUMN ... IF NOT EXISTS requiere MySQL 8.0.29 o superior. Si tu MySQL
-- es más viejo (poco probable en una instalación nueva de Ubuntu), quitá el
-- "IF NOT EXISTS" de las dos líneas de abajo — el script solo se corre una
-- vez, así que no hace falta que sea idempotente en ese caso.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sku VARCHAR(20) NULL UNIQUE AFTER category_id,
  ADD COLUMN IF NOT EXISTS marca_id INT NULL AFTER sku,
  -- DEFAULT 1: los productos que ya tenías quedan publicados tal cual
  -- estaban, sin que haya que tocarlos a mano.
  ADD COLUMN IF NOT EXISTS published TINYINT(1) NOT NULL DEFAULT 1 AFTER image_url;

-- La FK se agrega aparte: IF NOT EXISTS no aplica a restricciones. Si el
-- script se corre dos veces por error, esta línea fallará con "Duplicate
-- foreign key constraint name" — es seguro ignorar ese error puntual.
ALTER TABLE products
  ADD CONSTRAINT fk_products_marca FOREIGN KEY (marca_id) REFERENCES marcas(id);

CREATE TABLE IF NOT EXISTS product_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  qty INT NOT NULL,
  expiration_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
