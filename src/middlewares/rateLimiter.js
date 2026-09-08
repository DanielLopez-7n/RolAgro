const { rateLimit } = require("express-rate-limit");

/**
 * Límite estricto para la creación de pedidos.
 *
 * El endpoint POST /api/orders envía un correo en cada llamada y no exige
 * registro ni pago, así que sin este freno cualquiera podría inundar el
 * buzón de la empresa con pedidos falsos.
 */
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 5, // 5 pedidos por IP en esa ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "Has enviado demasiados pedidos seguidos. Espera unos minutos e intenta de nuevo.",
  },
});

/**
 * Límite general para el resto de la API (consulta del catálogo).
 * Es holgado: cargar la página hace apenas dos peticiones.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones. Intenta de nuevo en un momento." },
});

/**
 * Límite para el panel de administración.
 *
 * Es más holgado que el público porque una sesión de trabajo real (listar,
 * crear, editar y recargar) hace muchas más peticiones que una visita normal,
 * y no debe competir con los clientes por el mismo cupo. Aun así tiene tope:
 * el endpoint pide credenciales y no conviene dejarlo sin freno ante intentos
 * de adivinar la contraseña.
 */
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones. Intenta de nuevo en un momento." },
});

/**
 * Nota para el despliegue: si el sitio queda detrás de un proxy inverso
 * (Nginx, Render, Railway...), hay que habilitar app.set('trust proxy', 1)
 * en src/index.js. De lo contrario todas las peticiones se verán con la IP
 * del proxy y el límite se aplicaría a todos los visitantes en conjunto.
 */
module.exports = { orderLimiter, apiLimiter, adminLimiter };
