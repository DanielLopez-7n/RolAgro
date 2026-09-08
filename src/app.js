const path = require("path");
const express = require("express");
const morgan = require("morgan");
const helmet = require("helmet");

const productsRoutes = require("./routes/products.routes");
const ordersRoutes = require("./routes/orders.routes");
const adminRoutes = require("./routes/admin.routes");
const basicAuth = require("./middlewares/basicAuth");
const { apiLimiter, adminLimiter } = require("./middlewares/rateLimiter");
const { notFound, errorHandler } = require("./middlewares/errorHandler");

/**
 * Construcción de la aplicación Express.
 *
 * Está separada de src/index.js (que valida el entorno, escucha el puerto y
 * maneja el apagado) para que los tests puedan levantar la app en un puerto
 * efímero sin arrancar el servidor de verdad ni cortar el proceso cuando el
 * .env está incompleto.
 */
const app = express();

// En producción el servidor queda detrás de Nginx (ver DEPLOY.md): sin esto
// Express ve la IP del proxy en cada petición, y express-rate-limit (que lee
// req.ip) terminaría tratando a todos los visitantes como uno solo.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Cabeceras de seguridad básicas. Se define la CSP a mano (no el default de
// helmet) porque el sitio carga Bootstrap desde jsdelivr y el panel usa
// algunos estilos inline.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        fontSrc: ["'self'", "https://cdn.jsdelivr.net", "data:"],
        // Las fotos de producto son URLs que se pegan a mano en el panel
        // (image_url), de cualquier host: limitar esto a 'self' dejaría el
        // catálogo sin imágenes. Se permite cualquier origen HTTPS, pero no
        // http:, para no romper el candado del navegador con contenido mixto.
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
      },
    },
  })
);

// Registro de peticiones en consola: "dev" es compacto y coloreado para
// desarrollo; "combined" da el formato estándar de servidor para producción.
// En los tests se calla, para no ensuciar la salida del corredor.
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// Se acota el tamaño del cuerpo: un pedido legítimo son unos pocos kilobytes.
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "../public")));

// Comprobación de salud para quien administre el proceso (PM2, un balanceador,
// un monitor externo). No toca la base de datos: solo confirma que el
// proceso Node sigue vivo y respondiendo.
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Las vistas viven en src/templates, fuera de la carpeta estática.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

// El panel pide credenciales antes de servir siquiera el HTML.
app.get("/admin", basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "admin.html"));
});

// La API del panel cuelga de /admin a propósito: al estar bajo la misma ruta
// que ya pidió credenciales, el navegador las reenvía solo y el panel no
// vuelve a mostrar el diálogo de acceso en cada petición.
// Va antes del límite general porque una sesión de administración hace muchas
// más peticiones que una visita y no debe agotar el cupo público.
app.use("/admin/api", adminLimiter, adminRoutes);

app.use("/api", apiLimiter);
app.use("/api", productsRoutes);
app.use("/api", ordersRoutes);

// Ninguna ruta coincidió, y red de seguridad para cualquier error que llegue
// desde un controlador vía next(err). Ver src/middlewares/errorHandler.js.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
