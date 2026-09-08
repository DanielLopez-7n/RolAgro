# Despliegue de RolAgro (Hostinger VPS KVM)

Runbook para llevar RolAgro a producción en un VPS KVM de Hostinger (Ubuntu).
Pensado para ejecutarse a mano la primera vez; al final hay un flujo corto
para actualizaciones posteriores.

Convención: los bloques de código que empiezan con `$` corren en el VPS por
SSH; los que no, corren en tu máquina.

## Antes de empezar

- [ ] VPS KVM contratado (KVM 1 alcanza para este tamaño de sitio).
- [ ] Dominio decidido (propio, o el temporal `IP-del-VPS` mientras tanto).
- [ ] Rama `daniel` mergeada a `main` — se despliega desde `main`.
- [ ] Credenciales reales a mano: SMTP (Gmail App Password), número de
      WhatsApp, usuario/clave que querés para `/admin` en producción
      (no reutilices las de desarrollo).

## Fase 1 — Código (ya hecho en este repo)

Ya están en el repo, listos para producción:

- `app.set("trust proxy", 1)` cuando `NODE_ENV=production` (necesario detrás
  de Nginx, ver `src/middlewares/rateLimiter.js`).
- `helmet` con una CSP explícita que permite Bootstrap desde jsdelivr.
- `GET /health` para que PM2/un monitor externo confirme que el proceso vive.
- Apagado controlado (`SIGTERM`/`SIGINT`) que cierra el pool de MySQL antes
  de salir.
- `ecosystem.config.js` (PM2), `deploy/nginx.rolagro.conf`, `deploy/backup-db.sh`.

## Fase 2 — Provisionar el VPS

### 2.1 Acceso inicial y usuario de trabajo

```
$ ssh root@IP_DEL_VPS
$ apt update && apt upgrade -y
$ adduser deploy
$ usermod -aG sudo deploy
$ rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

A partir de acá, conectate como `deploy`, no como `root`:
`ssh deploy@IP_DEL_VPS`.

### 2.2 Firewall

```
$ sudo ufw allow OpenSSH
$ sudo ufw allow 80
$ sudo ufw allow 443
$ sudo ufw enable
```

El puerto 3306 (MySQL) **no se abre**: la app y MySQL viven en la misma
máquina y se hablan por `localhost`.

### 2.3 Node.js 22 LTS

```
$ curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
$ sudo apt install -y nodejs
$ node -v   # v22.x
```

### 2.4 MySQL

```
$ sudo apt install -y mysql-server
$ sudo mysql_secure_installation
```

Crear una base y un usuario **propios de la app** (no usar `root` en
producción):

```
$ sudo mysql
mysql> CREATE DATABASE rolagro CHARACTER SET utf8mb4;
mysql> CREATE USER 'rolagro'@'localhost' IDENTIFIED BY 'UNA_CLAVE_FUERTE_Y_UNICA';
mysql> GRANT ALL PRIVILEGES ON rolagro.* TO 'rolagro'@'localhost';
mysql> FLUSH PRIVILEGES;
mysql> EXIT;
```

Confirmá que MySQL solo escucha en localhost (es el default en Ubuntu):
`bind-address` debe decir `127.0.0.1` en
`/etc/mysql/mysql.conf.d/mysqld.cnf`.

### 2.5 PM2

```
$ sudo npm install -g pm2
```

## Fase 3 — Llevar el código y las variables de entorno

### 3.1 Clonar el repo

Con un deploy key de solo lectura (recomendado) o HTTPS + token:

```
$ git clone git@github.com:tu-usuario/RolAgro.git
$ cd RolAgro
$ git checkout main
```

### 3.2 `.env` de producción

**Nunca se copia por git** (está en `.gitignore`). Se crea a mano en el
servidor:

```
$ cp .env.example .env
$ nano .env
$ chmod 600 .env
```

Completar con valores **reales de producción**, distintos de los de
desarrollo:

- `NODE_ENV=production`
- `DB_HOST=localhost`, `DB_USER=rolagro`, `DB_PASSWORD=` (la del paso 2.4),
  `DB_NAME=rolagro`, `DB_SSL=false`
- `SMTP_USER`, `SMTP_PASS` (App Password de Gmail), `MAIL_TO`
- `ADMIN_USER`, `ADMIN_PASS` (credenciales nuevas, no las de desarrollo)
- `WHATSAPP_NUMBER`
- `PORT=3000` (Nginx lo expone hacia afuera; no hace falta abrirlo en el
  firewall)

### 3.3 Instalar dependencias e inicializar la base

```
$ npm ci --omit=dev
$ npm run db:init
```

### 3.4 Arrancar con PM2

```
$ pm2 start ecosystem.config.js
$ pm2 save
$ pm2 startup systemd    # corré el comando que imprime, con sudo
```

Verificación rápida: `curl http://localhost:3000/health` debe devolver
`{"status":"ok"}`.

## Fase 4 — Nginx, dominio y HTTPS

### 4.1 Nginx como reverse proxy

```
$ sudo apt install -y nginx
$ sudo cp deploy/nginx.rolagro.conf /etc/nginx/sites-available/rolagro
$ sudo nano /etc/nginx/sites-available/rolagro   # reemplazar tudominio.com
$ sudo ln -s /etc/nginx/sites-available/rolagro /etc/nginx/sites-enabled/
$ sudo nginx -t && sudo systemctl reload nginx
```

### 4.2 DNS

En el panel donde administrás el dominio (Hostinger si vino incluido con el
plan, o el registrador donde lo compraste), crear registros **A** apuntando
a la IP del VPS:

| Tipo | Nombre | Valor       |
|------|--------|-------------|
| A    | @      | IP_DEL_VPS  |
| A    | www    | IP_DEL_VPS  |

La propagación puede tardar de minutos a un par de horas.

### 4.3 HTTPS con Certbot

```
$ sudo apt install -y certbot python3-certbot-nginx
$ sudo certbot --nginx -d tudominio.com -d www.tudominio.com
```

Certbot reescribe el bloque de Nginx para servir HTTPS y agrega el
timer de renovación automática (`systemctl status certbot.timer`).

### 4.4 Actualizar las URLs absolutas del sitio

`src/templates/index.html` tiene `og:url` y `og:image` apuntando a
`https://rolagro.com` como placeholder (para que las vistas previas al
compartir el link funcionen). Reemplazar por el dominio real y redesplegar.

## Fase 5 — Verificación post-deploy

- [ ] `https://tudominio.com/` carga el catálogo y el candado HTTPS es válido.
- [ ] El carrito y el checkout de invitado funcionan y llega el correo del
      pedido.
- [ ] El enlace de WhatsApp abre con el número correcto.
- [ ] `https://tudominio.com/admin` pide credenciales (no queda abierto) y
      el panel funciona con las credenciales de producción.
- [ ] `curl -I https://tudominio.com/api/products` varias veces seguidas
      dispara el rate limit por IP real (no agrupa a todos los visitantes) —
      confirma que `trust proxy` + los headers de Nginx están bien puestos.
- [ ] `pm2 list` muestra `rolagro` como `online`; `pm2 logs rolagro` sin
      errores.
- [ ] Backup de prueba: `./deploy/backup-db.sh` genera un `.sql.gz` en
      `backups/`.

## Fase 6 — Continuidad

- **Backups**: cron diario con `deploy/backup-db.sh` (instrucciones dentro
  del script).
- **Logs**: `pm2 logs rolagro` en vivo; `pm2 install pm2-logrotate` si los
  archivos de log crecen mucho.
- **Actualizar el sitio** (deploy manual, alcanza para esta escala):

  ```
  $ cd RolAgro
  $ git pull origin main
  $ npm ci --omit=dev
  $ npm run db:init      # solo si hubo cambios de schema/seed
  $ pm2 reload rolagro   # reinicio sin downtime
  ```

  Si más adelante conviene automatizar esto con GitHub Actions (deploy por
  SSH al hacer push a `main`), se arma aparte cuando el flujo manual esté
  probado y estable.
