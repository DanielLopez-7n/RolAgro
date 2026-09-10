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
      (no reutilices las de desarrollo; la clave necesita 12 caracteres o
      más).

## Fase 1 — Código (ya hecho en este repo)

Ya están en el repo, listos para producción:

- `app.set("trust proxy", 1)` cuando `NODE_ENV=production` (necesario detrás
  de Nginx, ver `src/middlewares/rateLimiter.js`).
- `helmet` con una CSP explícita que permite Bootstrap desde jsdelivr.
- `GET /health` para que PM2/un monitor externo confirme que el proceso vive.
- Apagado controlado (`SIGTERM`/`SIGINT`) que cierra el pool de MySQL antes
  de salir.
- Validación del `.env` al arrancar (`src/config/env.js`): en producción
  corta el arranque si falta una variable crítica o quedó un valor de
  ejemplo.
- Tests de humo (`npm test`, sin dependencias externas ni base de datos):
  validación del checkout, escape de HTML del correo, enlace de WhatsApp,
  chequeo del `.env` y las rutas que no tocan MySQL (salud, panel con y sin
  credenciales, 404, cabeceras de seguridad).
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
mysql> CREATE DATABASE rolagro_db CHARACTER SET utf8mb4;
mysql> CREATE USER 'rolagro'@'localhost' IDENTIFIED BY 'UNA_CLAVE_FUERTE_Y_UNICA';
mysql> GRANT ALL PRIVILEGES ON rolagro_db.* TO 'rolagro'@'localhost';
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

### 2.6 fail2ban para SSH

El firewall del paso 2.2 decide **qué puertos** están abiertos, pero no mira
quién entra por ellos. El 22 tiene que quedar abierto para poder trabajar, y
un VPS con IP pública empieza a recibir intentos de login automatizados a las
pocas horas de existir — miles por día, sin que nadie te conozca.

fail2ban lee los logs, cuenta los intentos fallidos por IP y le pide al
firewall que bloquee a quien insiste. Es la pieza que le falta a ufw.

```
$ sudo apt install -y fail2ban
```

La configuración por defecto **no se edita** (`jail.conf` se sobrescribe en
cada actualización del paquete): los cambios propios van en `jail.local`, que
fail2ban lee después y tiene prioridad.

```
$ sudo nano /etc/fail2ban/jail.local
```

```ini
[sshd]
enabled  = true
maxretry = 5
findtime = 10m
bantime  = 1h
```

Se lee así: cinco fallos desde la misma IP dentro de diez minutos, y esa IP
queda bloqueada una hora. No conviene poner `bantime = -1` (para siempre): el
día que te equivoques de llave desde tu propia casa, te dejás afuera vos.

```
$ sudo systemctl enable --now fail2ban
$ sudo fail2ban-client status sshd
```

Ese último comando tiene que listar la jaula `sshd` como activa. Si dice que
no encuentra el log, es lo típico de Ubuntu 24.04, que dejó de escribir
`/var/log/auth.log` y manda todo al journal de systemd: agregá
`backend = systemd` dentro del bloque `[sshd]` y reiniciá el servicio.

> La jaula del panel de administración se arma en la Fase 6, cuando la app
> ya está corriendo y existe el archivo de log que necesita leer.

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
  `DB_NAME=rolagro_db`, `DB_SSL=false`
- `SMTP_USER`, `SMTP_PASS` (App Password de Gmail), `MAIL_TO`
- `ADMIN_USER`, `ADMIN_PASS` (credenciales nuevas, no las de desarrollo).
  La contraseña necesita 12 caracteres o más o el proceso no arranca; una
  frase larga es mejor que ocho caracteres con símbolos.
- `SESSION_SECRET`: firma la cookie de sesión del panel. No se inventa a
  mano, se genera **en el servidor** con `openssl rand -base64 32` y se
  pega tal cual. Si algún día sospechás que alguien entró, cambiarla cierra
  todas las sesiones abiertas de una.
- `WHATSAPP_NUMBER`
- `PORT=3000` (Nginx lo expone hacia afuera; no hace falta abrirlo en el
  firewall)

Con `NODE_ENV=production`, la app **no arranca** si falta alguna de esas
variables, si tienen un formato inválido, o si quedó algún valor de ejemplo
copiado de `.env.example` (ver `src/config/env.js`). Es a propósito: un
`.env` a medias no se nota hasta que un cliente hace un pedido y el correo
nunca llega. Si PM2 muestra el proceso como `errored`, `pm2 logs rolagro`
lista exactamente qué variable falta.

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
- [ ] `https://tudominio.com/admin` redirige a `/admin/login` (no queda
      abierto), se entra con las credenciales de producción, y el botón
      "Salir" cierra la sesión y vuelve al formulario.
- [ ] Con el certificado ya emitido, la cookie de sesión sale con el flag
      `Secure`: en las herramientas del navegador (Application → Cookies),
      `rolagro_admin` debe mostrar Secure, HttpOnly y SameSite=Strict.
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

- **fail2ban para el panel** (completa la jaula de SSH del paso 2.6). El
  límite de `rateLimiter.js` ya corta a los 10 intentos por cuarto de hora,
  pero eso vive dentro del proceso: se reinicia con cada `pm2 reload` y no
  hace nada contra alguien que vuelva mañana. fail2ban bloquea la IP a nivel
  de firewall, antes de que la petición llegue a Node.

  El detalle que hace falta resolver: `POST /admin/login` responde con un
  redirect (302) tanto si la clave es correcta como si no, así que **desde el
  log de Nginx los dos casos son idénticos**. Por eso la app escribe una línea
  propia cuando el intento falla (ver `src/controllers/auth.controller.js`),
  y el filtro lee esa:

  ```
  $ sudo nano /etc/fail2ban/filter.d/rolagro-panel.conf
  ```

  ```ini
  [Definition]
  datepattern = ^%%Y-%%m-%%dT%%H:%%M:%%S
  failregex   = ^.*\[auth\] intento de acceso fallido al panel desde <HOST>$
  ignoreregex =
  ```

  La jaula, agregada a `/etc/fail2ban/jail.local`:

  ```ini
  [rolagro-panel]
  enabled  = true
  filter   = rolagro-panel
  logpath  = /home/deploy/.pm2/logs/rolagro-error.log
  port     = http,https
  maxretry = 5
  findtime = 10m
  bantime  = 1h
  ```

  El log es el de **error** y no el de salida porque la app usa
  `console.warn`, que escribe en stderr; PM2 separa los dos archivos.

  Para probarlo: entrá a `/admin/login` desde otro dispositivo y erralé la
  clave seis veces. `sudo fail2ban-client status rolagro-panel` tiene que
  mostrar esa IP en la lista de baneadas. Para sacarte del banco:
  `sudo fail2ban-client set rolagro-panel unbanip TU_IP`.

  **Revisá que la IP del log sea la real.** Si en
  `pm2 logs rolagro --err` ves `127.0.0.1` o algo con el prefijo `::ffff:`,
  la app está viendo a Nginx en vez de al cliente, y fail2ban terminaría
  bloqueando al propio servidor. Eso significa que `trust proxy` o el
  `X-Forwarded-For` de Nginx no están funcionando (ver `src/app.js` y
  `deploy/nginx.rolagro.conf`).
- **Actualizar el sitio** (deploy manual, alcanza para esta escala):

  ```
  $ cd RolAgro
  $ git pull origin main
  $ npm ci --omit=dev
  $ npm test              # si falla, no sigas: el sitio en vivo queda como está
  $ npm run db:init       # solo si hubo cambios de schema/seed
  $ pm2 reload rolagro    # reinicio sin downtime
  ```

  Los tests corren sin base de datos, sin red y sin devDependencies (usan
  el corredor propio de Node), así que se pueden ejecutar tal cual en el
  servidor antes de recargar.

  Si más adelante conviene automatizar esto con GitHub Actions (deploy por
  SSH al hacer push a `main`), se arma aparte cuando el flujo manual esté
  probado y estable.
