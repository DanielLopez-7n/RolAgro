require("dotenv").config();

/**
 * Verificación de las variables de entorno al arrancar.
 *
 * Un .env incompleto no rompe nada visible: la app levanta, el catálogo se
 * ve bien, y falla justo donde no se nota —el correo del pedido no sale
 * (mail.service.js se traga ese error a propósito, porque el correo es un
 * aviso y no la venta), el botón de WhatsApp arma un enlace sin número, o
 * /admin responde 503—. En producción es preferible que el proceso no
 * arranque a que la dueña se entere por un cliente que nunca recibió
 * respuesta.
 *
 * En desarrollo solo avisa: levantar el catálogo local sin SMTP configurado
 * es un caso de uso legítimo.
 */

/**
 * Largo mínimo de la contraseña del panel.
 *
 * Solo se mide el largo, sin exigir mayúsculas ni símbolos: esas reglas
 * empujan a claves cortas y retorcidas ("P@ss1!"), que se rompen antes que
 * una frase larga. Y esta contraseña se escribe una vez en el .env del
 * servidor y se guarda en un gestor — no hay que tipearla todos los días,
 * así que no hay motivo para que sea corta.
 */
const MIN_ADMIN_PASS_LENGTH = 12;

/** Variables sin las cuales el sitio no cumple su función en producción. */
const CHECKS = [
  { name: "DB_USER", detail: "usuario de MySQL" },
  { name: "DB_PASSWORD", detail: "contraseña de MySQL" },
  { name: "DB_NAME", detail: "nombre de la base de datos" },
  {
    name: "SMTP_USER",
    detail: "cuenta que envía los correos",
    isValid: (value) => value.includes("@"),
  },
  { name: "SMTP_PASS", detail: "App Password de Gmail" },
  {
    name: "MAIL_TO",
    detail: "destinatario de los pedidos",
    isValid: (value) => value.includes("@"),
  },
  { name: "ADMIN_USER", detail: "usuario del panel /admin" },
  {
    name: "ADMIN_PASS",
    // El mínimo va dentro del `detail` porque es lo que se imprime cuando
    // falla: "tiene un formato inválido" a secas no le dice a nadie qué
    // corregir, y este mensaje se lee en `pm2 logs` con el sitio caído.
    detail: `contraseña del panel /admin, mínimo ${MIN_ADMIN_PASS_LENGTH} caracteres`,
    isValid: (value) => value.length >= MIN_ADMIN_PASS_LENGTH,
  },
  {
    name: "WHATSAPP_NUMBER",
    // wa.me solo acepta dígitos: un "+", un espacio o un guion rompen el
    // enlace sin dar ningún error visible.
    detail: "número de la empresa, solo dígitos y sin '+'",
    isValid: (value) => /^\d{8,15}$/.test(value),
  },
];

/**
 * Valores de ejemplo de .env.example. Si alguno sobrevive hasta producción
 * es que el .env se copió sin completar, y hay uno especialmente grave:
 * ADMIN_PASS dejaría el panel con una contraseña pública.
 */
const PLACEHOLDERS = new Set([
  "cambia_esta_clave",
  "tu_correo@gmail.com",
  "tu_app_password",
  "pedidos@rolagro.com",
  "549XXXXXXXXXX",
]);

/**
 * Devuelve la lista de problemas de configuración, sin efectos secundarios.
 *
 * Está separada de checkEnv para poder probarla: recibe el entorno como
 * parámetro en vez de leer process.env directamente.
 */
function findProblems(env = process.env) {
  const problems = [];

  for (const { name, detail, isValid } of CHECKS) {
    const value = (env[name] || "").trim();

    if (!value) {
      problems.push(`${name} falta (${detail}).`);
    } else if (isValid && !isValid(value)) {
      problems.push(`${name} tiene un formato inválido (${detail}).`);
    } else if (PLACEHOLDERS.has(value)) {
      problems.push(
        `${name} todavía tiene el valor de ejemplo de .env.example (${detail}).`
      );
    }
  }

  return problems;
}

/**
 * Revisa la configuración. En producción corta el arranque si algo falta;
 * en desarrollo deja seguir con una advertencia.
 */
function checkEnv() {
  const problems = findProblems();

  if (problems.length === 0) return;

  const list = problems.map((problem) => `  - ${problem}`).join("\n");

  if (process.env.NODE_ENV === "production") {
    console.error(
      `\nRolAgro no puede arrancar: hay ${problems.length} problema(s) en el .env del servidor.\n${list}\n\n` +
        "Corregí el .env y volvé a arrancar (pm2 restart rolagro).\n"
    );
    process.exit(1);
  }

  console.warn(
    `\nAviso: el .env está incompleto. En producción esto impediría el arranque.\n${list}\n`
  );
}

module.exports = { checkEnv, findProblems };
