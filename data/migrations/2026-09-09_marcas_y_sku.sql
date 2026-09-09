-- Migración puntual: agrega `marcas`, `product_batches` y las columnas
-- `sku`/`marca_id`/`published` de `products` a una base de datos que ya
-- existía ANTES de este cambio.
--
-- `data/schema.sql` ya describe estas tablas con CREATE TABLE IF NOT EXISTS,
-- así que una base nueva (`npm run db:init` desde cero) las recibe sin este
-- archivo. Este script es solo para no tener que borrar una base de datos
-- que ya tenía datos cargados.
--
-- Uso (una sola vez, por base de datos existente):
--   mysql -u USUARIO -p rolagro_db < data/migrations/2026-09-09_marcas_y_sku.sql
--
-- Es re-ejecutable: cada paso comprueba antes si ya está aplicado, así que
-- correrlo dos veces no falla ni duplica nada.
--
-- Nota sobre la sintaxis: MySQL NO soporta "ALTER TABLE ... ADD COLUMN IF
-- NOT EXISTS" (eso es una extensión de MariaDB, y en MySQL es un error de
-- sintaxis en cualquier versión). Por eso cada ALTER va envuelto en una
-- consulta a information_schema y un PREPARE: es la forma portable de
-- lograr el mismo efecto en MySQL.

CREATE TABLE IF NOT EXISTS marcas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

SET @db := DATABASE();

-- products.sku — codigo de referencia del ERP.
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'products'
                 AND COLUMN_NAME = 'sku');
SET @sql := IF(@falta,
  'ALTER TABLE products ADD COLUMN sku VARCHAR(20) NULL UNIQUE AFTER category_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- products.marca_id — fabricante, opcional.
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'products'
                 AND COLUMN_NAME = 'marca_id');
SET @sql := IF(@falta,
  'ALTER TABLE products ADD COLUMN marca_id INT NULL AFTER sku',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- products.published — DEFAULT 1 para que los productos que ya existían
-- queden publicados tal cual estaban, sin tener que tocarlos a mano.
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'products'
                 AND COLUMN_NAME = 'published');
SET @sql := IF(@falta,
  'ALTER TABLE products ADD COLUMN published TINYINT(1) NOT NULL DEFAULT 1 AFTER image_url',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK de products.marca_id -> marcas.id.
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.TABLE_CONSTRAINTS
               WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'products'
                 AND CONSTRAINT_NAME = 'fk_products_marca');
SET @sql := IF(@falta,
  'ALTER TABLE products ADD CONSTRAINT fk_products_marca FOREIGN KEY (marca_id) REFERENCES marcas(id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS product_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  qty INT NOT NULL,
  expiration_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
