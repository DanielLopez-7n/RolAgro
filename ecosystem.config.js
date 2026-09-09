// Configuración de PM2 para producción.
// Uso en el servidor: pm2 start ecosystem.config.js
//
// Un solo proceso ("fork", no "cluster"): el rate limiting de
// src/middlewares/rateLimiter.js guarda los contadores en memoria, y con
// varias instancias cada una llevaría su propia cuenta, debilitando el
// límite. Para el tráfico esperado de un catálogo chico, un proceso alcanza.
//
// Las credenciales (DB_*, SMTP_*, ADMIN_*, etc.) NO van acá: las carga
// src/index.js desde el .env del servidor vía dotenv. Acá solo va lo que
// controla cómo corre el proceso.
module.exports = {
  apps: [
    {
      name: "rolagro",
      script: "src/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        // El proceso corre en la hora de Colombia, no en la del servidor.
        //
        // El panel de vencimientos calcula "días restantes" contra el día de
        // HOY (ver batches.service.js, daysUntil). Si el VPS quedara en UTC
        // -lo habitual en un servidor recién instalado-, entre las 7pm y la
        // medianoche de Colombia el proceso ya estaría contando el día
        // siguiente: un lote que vence hoy aparecería como vencido durante
        // esas horas. Las fechas guardadas no cambian; lo que se fija acá es
        // qué día considera "hoy" el servidor.
        TZ: "America/Bogota",
      },
      max_memory_restart: "300M",
      // Si el proceso reinicia en bucle (crash loop), mejor que PM2 se
      // rinda a que consuma recursos reiniciando para siempre.
      max_restarts: 10,
      min_uptime: "15s",
    },
  ],
};
