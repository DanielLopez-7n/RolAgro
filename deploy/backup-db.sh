#!/usr/bin/env bash
# Backup diario de la base de datos RolAgro.
#
# Instalación en el VPS (una sola vez):
#   chmod +x deploy/backup-db.sh
#   crontab -e
#   # agregar la línea (corre todos los días a las 3 AM):
#   0 3 * * * /ruta/completa/a/rolagro/deploy/backup-db.sh >> /var/log/rolagro-backup.log 2>&1
#
# Lee DB_NAME/DB_USER/DB_PASSWORD del .env del proyecto: no hace falta
# repetir la contraseña en el crontab, donde quedaría visible para
# cualquiera con acceso a la máquina.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
DAYS_TO_KEEP=7

# shellcheck disable=SC1091
set -a
source "$PROJECT_DIR/.env"
set +a

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F_%H%M%S)"
OUT_FILE="$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"

MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --host="${DB_HOST:-localhost}" \
  --port="${DB_PORT:-3306}" \
  --user="${DB_USER:-root}" \
  --single-transaction \
  --routines \
  "$DB_NAME" | gzip > "$OUT_FILE"

echo "Backup creado: $OUT_FILE"

# Retención simple: se borran los backups más viejos que $DAYS_TO_KEEP días.
find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime "+$DAYS_TO_KEEP" -delete
