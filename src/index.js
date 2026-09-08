require("dotenv").config();
const path = require("path");
const express = require("express");
const morgan = require("morgan");

const productsRoutes = require("./routes/products.routes");
const ordersRoutes = require("./routes/orders.routes");
const adminRoutes = require("./routes/admin.routes");
const basicAuth = require("./middlewares/basicAuth");
const { apiLimiter, adminLimiter } = require("./middlewares/rateLimiter");
const { notFound, errorHandler } = require("./middlewares/errorHandler");

const app = express();

// Registro de peticiones en consola: "dev" es compacto y coloreado para
// desarrollo; "combined" da el formato estándar de servidor para producción.
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Se acota el tamaño del cuerpo: un pedido legítimo son unos pocos kilobytes.
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "../public")));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RolAgro corriendo en http://localhost:${PORT}`);
});
