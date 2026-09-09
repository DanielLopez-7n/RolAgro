const multer = require("multer");
const AppError = require("../utils/AppError");
const { MAX_FILE_BYTES } = require("../services/inventoryImport.service");

/**
 * Middleware de subida para la importación de inventario.
 *
 * Memoria, no disco: el archivo se procesa entero y se descarta (ver
 * inventoryImport.service.js), no hace falta persistirlo en el servidor. El
 * límite de tamaño es el mismo que usa el servicio al leerlo desde un Buffer
 * directo, para que ambos caminos rechacen lo mismo.
 */
// Sin fileFilter: se acepta cualquier archivo acá y se valida la extensión
// después, ya con `req.file` disponible (ver uploadExcelFile). Rechazar
// dentro de fileFilter dejaría el archivo sin llegar a `req.file`, y el
// mensaje de error tendría que adivinar por qué se rechazó en vez de
// mirar el nombre real que mandó el usuario.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
}).single("file");

/**
 * Envuelve `upload` a mano (en vez de pasarlo directo como middleware) para
 * traducir sus errores a AppError. Sin esto, un archivo demasiado grande o
 * de un tipo no permitido cae en el manejador de errores genérico como un
 * 500 "Ocurrió un error inesperado" — un dato de entrada malo, no un fallo
 * del servidor.
 */
function uploadExcelFile(req, res, next) {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(
        AppError.badRequest(
          `El archivo supera el tamaño máximo permitido (${MAX_FILE_BYTES / 1024 / 1024} MB).`
        )
      );
    }
    if (err) {
      return next(AppError.badRequest("No se pudo procesar el archivo subido."));
    }
    if (!req.file) {
      return next(AppError.badRequest("Adjuntá un archivo Excel (.xlsx) para importar."));
    }
    if (!req.file.originalname.toLowerCase().endsWith(".xlsx")) {
      return next(
        AppError.badRequest(
          `El archivo debe ser un Excel (.xlsx). Recibí "${req.file.originalname}".`
        )
      );
    }
    next();
  });
}

module.exports = uploadExcelFile;
