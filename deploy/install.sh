#!/usr/bin/env bash
# Einrichtung von Kursbuch auf einem frischen Ubuntu-VPS (22.04/24.04).
#
#   sudo bash deploy/install.sh dashboard.example.de admin@example.de
#
# Voraussetzung: Der DNS-A-Record (und ggf. AAAA) der Subdomain zeigt auf die VPS-IP.
set -euo pipefail

DOMAIN="${1:?Aufruf: sudo bash deploy/install.sh <subdomain> <email-fuer-letsencrypt>}"
EMAIL="${2:?E-Mail für das TLS-Zertifikat fehlt}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/kursbuch
ENV_FILE=/etc/kursbuch/kursbuch.env

[[ $EUID -eq 0 ]] || { echo "Bitte mit sudo ausführen."; exit 1; }

echo "==> Pakete"
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip nginx certbot python3-certbot-nginx rsync ufw

echo "==> Benutzer und Verzeichnisse"
id kursbuch &>/dev/null || useradd --system --home /var/lib/kursbuch --shell /usr/sbin/nologin kursbuch
install -d -o kursbuch -g kursbuch -m 750 /var/lib/kursbuch /var/lib/kursbuch/cache
install -d -m 750 /etc/kursbuch

echo "==> Anwendung nach $APP kopieren"
rsync -a --delete --exclude '.git' --exclude 'var' --exclude '.env' --exclude '__pycache__' "$SRC/" "$APP/"
python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$APP/backend/requirements.txt"
chown -R root:root "$APP"

if [[ ! -f $ENV_FILE ]]; then
  echo "==> Dashboard-Passwort festlegen (mind. 10 Zeichen)"
  HASH="$(cd "$APP/backend" && "$APP/venv/bin/python" -m app.auth)"
  SECRET="$("$APP/venv/bin/python" -c 'import secrets; print(secrets.token_urlsafe(48))')"
  cat > "$ENV_FILE" <<CONF
DASHBOARD_PASSWORD_HASH=$HASH
SECRET_KEY=$SECRET
DATA_PROVIDER=yahoo
DATA_DIR=/var/lib/kursbuch
FRONTEND_DIR=$APP/frontend
COOKIE_SECURE=1
SESSION_DAYS=14
CONF
  chown root:kursbuch "$ENV_FILE"
  chmod 640 "$ENV_FILE"
else
  echo "==> $ENV_FILE existiert bereits – unverändert gelassen"
fi

echo "==> systemd"
install -m 644 "$APP/deploy/kursbuch.service" /etc/systemd/system/kursbuch.service
systemctl daemon-reload
systemctl enable --now kursbuch
systemctl restart kursbuch

echo "==> nginx"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP/deploy/nginx.conf.template" > /etc/nginx/sites-available/kursbuch
ln -sf /etc/nginx/sites-available/kursbuch /etc/nginx/sites-enabled/kursbuch
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "==> TLS-Zertifikat (Let's Encrypt)"
certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN"

echo
echo "Fertig: https://$DOMAIN"
echo "Logs:   journalctl -u kursbuch -f"
