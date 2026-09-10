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
 * Límite del formulario de login del panel.
 *
 * Es el más estricto de todos y por el motivo más directo: es el único
 * endpoint donde alguien puede probar contraseñas. El adminLimiter de arriba
 * no alcanza para esto —500 intentos cada 15 minutos son miles de pruebas por
 * día— porque está dimensionado para una sesión de trabajo real, no para
 * frenar a quien adivina.
 *
 * Diez por ventana no molesta a nadie: entrar al panel de verdad son una o
 * dos veces por jornada, y la sesión dura 12 horas (ver session.js).
 *
 * Se cuentan todos los intentos, no solo los fallidos: acierto y error
 * responden los dos con un redirect (302), así que express-rate-limit no
 * puede distinguirlos por código de estado.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Se responde con un redirect y no con el JSON por defecto: quien llega acá
  // está mirando un formulario, y un volcado de JSON no le explica nada.
  handler: (req, res) => res.redirect("/admin/login?error=limite"),
});

/**
 * Nota para el despliegue: si el sitio queda detrás de un proxy inverso
 * (Nginx, Render, Railway...), hay que habilitar app.set('trust proxy', 1)
 * en src/index.js. De lo contrario todas las peticiones se verán con la IP
 * del proxy y el límite se aplicaría a todos los visitantes en conjunto.
 */
module.exports = { orderLimiter, apiLimiter, adminLimiter, loginLimiter };
