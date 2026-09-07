require("dotenv").config();
const path = require("path");
const express = require("express");

const productsRoutes = require("./routes/products.routes");
const ordersRoutes = require("./routes/orders.routes");
const { apiLimiter } = require("./middlewares/rateLimiter");

const app = express();

// Se acota el tamaño del cuerpo: un pedido legítimo son unos pocos kilobytes.
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "../public")));

// La vista vive en src/templates, fuera de la carpeta estática.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

app.use("/api", apiLimiter);
app.use("/api", productsRoutes);
app.use("/api", ordersRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RolAgro corriendo en http://localhost:${PORT}`);
});
