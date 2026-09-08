require("dotenv").config();

const { checkEnv } = require("./config/env");
const pool = require("./config/db");

/**
 * Punto de entrada del servidor.
 *
 * Solo se ocupa del ciclo de vida del proceso: validar el entorno, escuchar
 * el puerto y apagar ordenadamente. La app en sí se arma en src/app.js, que
 * los tests importan sin arrancar nada.
 */

// Antes de levantar nada: si el .env del servidor está incompleto, en
// producción esto corta el arranque. Ver src/config/env.js.
checkEnv();

// Se requiere después de checkEnv a propósito: no tiene sentido construir la
// app si la configuración ya es inválida.
const app = require("./app");

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`RolAgro corriendo en http://localhost:${PORT}`);
});

// Apagado controlado: PM2/systemd mandan SIGTERM al reiniciar o desplegar.
// Se deja de aceptar conexiones nuevas, se espera a que terminen las
// peticiones en curso y recién ahí se cierra el pool de MySQL, para no
// cortar un pedido a mitad de una consulta.
function shutdown(signal) {
  console.log(`${signal} recibido, cerrando RolAgro...`);
  server.close(() => {
    pool
      .end()
      .catch((err) => console.error("Error al cerrar el pool de MySQL:", err))
      .finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
