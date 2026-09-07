require("dotenv").config();
const path = require("path");
const express = require("express");

const productsRoutes = require("./routes/products.routes");
const ordersRoutes = require("./routes/orders.routes");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// La vista vive en src/templates, fuera de la carpeta estática.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

app.use("/api", productsRoutes);
app.use("/api", ordersRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RolAgro corriendo en http://localhost:${PORT}`);
});
