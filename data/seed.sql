-- RolAgro — datos de ejemplo (mismos productos usados en la Fase 1 del frontend)

INSERT INTO categories (name) VALUES
  ('Fertilizantes'),
  ('Semillas'),
  ('Herramientas'),
  ('Agroquímicos'),
  ('Riego')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO products (category_id, name, description, price, image_url) VALUES
  (
    (SELECT id FROM categories WHERE name = 'Fertilizantes'),
    'Fertilizante NPK 20-20-20',
    'Saco de 50kg, fórmula balanceada para todo tipo de cultivo.',
    45000,
    'https://placehold.co/400x300?text=Fertilizante'
  ),
  (
    (SELECT id FROM categories WHERE name = 'Semillas'),
    'Semillas de Maíz Híbrido',
    'Bolsa 1kg, alto rendimiento y resistencia a plagas.',
    18500,
    'https://placehold.co/400x300?text=Semillas'
  ),
  (
    (SELECT id FROM categories WHERE name = 'Herramientas'),
    'Pala de Jardinería Reforzada',
    'Mango de madera y punta de acero templado.',
    22900,
    'https://placehold.co/400x300?text=Herramienta'
  ),
  (
    (SELECT id FROM categories WHERE name = 'Agroquímicos'),
    'Herbicida Selectivo 1L',
    'Control eficaz de malezas de hoja ancha.',
    32000,
    'https://placehold.co/400x300?text=Agroquimico'
  ),
  (
    (SELECT id FROM categories WHERE name = 'Riego'),
    'Kit de Riego por Goteo 20m',
    'Sistema completo, fácil instalación, ahorra agua.',
    56700,
    'https://placehold.co/400x300?text=Riego'
  ),
  (
    (SELECT id FROM categories WHERE name = 'Agroquímicos'),
    'Fungicida Preventivo 500ml',
    'Protección contra hongos en cultivos hortícolas.',
    27300,
    'https://placehold.co/400x300?text=Fungicida'
  );
