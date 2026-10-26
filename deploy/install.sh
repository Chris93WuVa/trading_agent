#!/usr/bin/env bash
# Einrichtung von Kursbuch auf einem Ubuntu-VPS (22.04/24.04) – auch neben einer
# bestehenden Website (z. B. WordPress) auf derselben IP.
#
#   sudo bash deploy/install.sh dashboard.example.de admin@example.de
#
# Ablauf:
#   1. Python-Umgebung + Dienst "kursbuch" (lauscht nur lokal auf 127.0.0.1:8710)
#   2. Erkennt den Webserver auf Port 80 (nginx oder Apache) und legt dort einen
#      zusätzlichen virtuellen Host NUR für die Subdomain an. Bestehende Sites
#      (WordPress) werden nicht verändert.
#   3. Let's-Encrypt-Zertifikat für die Subdomain per certbot.
#
# Voraussetzung: DNS-A-Record (ggf. AAAA) der Subdomain zeigt auf die VPS-IP.
set -euo pipefail

DOMAIN="${1:?Aufruf: sudo bash deploy/install.sh <subdomain> <email-fuer-zertifikat>}"
EMAIL="${2:?E-Mail für das TLS-Zertifikat fehlt}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/kursbuch
ENV_FILE=/etc/kursbuch/kursbuch.env
PORT=8710

[[ $EUID -eq 0 ]] || { echo "Bitte mit sudo ausführen."; exit 1; }

port_owner() { ss -Hltnp "sport = :$1" 2>/dev/null | grep -oP 'users:\(\("\K[^"]+' | head -1 || true; }

echo "==> Prüfungen"
if [[ -n "$(port_owner $PORT)" ]]; then
  echo "Port $PORT ist bereits belegt ($(port_owner $PORT)). Bitte PORT in diesem Skript, in"
  echo "deploy/kursbuch.service und in den Webserver-Vorlagen anpassen."; exit 1
fi
WEB="$(port_owner 80)"
case "$WEB" in
  ""|nginx) WEB=nginx ;;
  apache2|httpd) WEB=apache ;;
  *)
    echo "Port 80 wird von '$WEB' bedient (z. B. OpenLiteSpeed/CyberPanel, Caddy, Docker)."
    echo "Automatische Einrichtung nur für nginx und Apache. Lege in deinem Webserver einen"
    echo "Reverse-Proxy für $DOMAIN -> http://127.0.0.1:$PORT an (siehe README) und starte"
    echo "dann dieses Skript mit SKIP_WEB=1."
    [[ "${SKIP_WEB:-0}" == 1 ]] || exit 1
    WEB=none ;;
esac
echo "    Webserver: $WEB"

PUBLIC_IP="$(curl -4fsS --max-time 5 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [[ -n "$PUBLIC_IP" && "$DNS_IP" != "$PUBLIC_IP" ]]; then
  echo "    WARNUNG: $DOMAIN zeigt auf '${DNS_IP:-nichts}', dieser Server hat $PUBLIC_IP."
  echo "    Ohne korrekten DNS-Eintrag schlägt das Zertifikat fehl."
fi

echo "==> Pakete"
apt-get update -qq
PKGS=(python3 python3-venv python3-pip rsync certbot)
case "$WEB" in
  nginx) PKGS+=(nginx python3-certbot-nginx) ;;
  apache) PKGS+=(python3-certbot-apache) ;;
esac
apt-get install -y -qq "${PKGS[@]}"

echo "==> Benutzer und Verzeichnisse"
id kursbuch &>/dev/null || useradd --system --home /var/lib/kursbuch --shell /usr/sbin/nologin kursbuch
install -d -o kursbuch -g kursbuch -m 750 /var/lib/kursbuch /var/lib/kursbuch/cache
install -d -m 750 /etc/kursbuch

echo "==> Anwendung nach $APP kopieren"
rsync -a --delete --exclude '.git' --exclude 'var' --exclude '.env' --exclude '__pycache__' --exclude 'venv' "$SRC/" "$APP/"
[[ -d "$APP/venv" ]] || python3 -m venv "$APP/venv"
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

echo "==> systemd-Dienst"
install -m 644 "$APP/deploy/kursbuch.service" /etc/systemd/system/kursbuch.service
systemctl daemon-reload
systemctl enable --now kursbuch
systemctl restart kursbuch
sleep 2
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null && echo "    Dienst läuft auf 127.0.0.1:$PORT"

case "$WEB" in
  nginx)
    echo "==> nginx: virtueller Host für $DOMAIN"
    sed "s/__DOMAIN__/$DOMAIN/g" "$APP/deploy/nginx.conf.template" > /etc/nginx/sites-available/kursbuch
    ln -sf /etc/nginx/sites-available/kursbuch /etc/nginx/sites-enabled/kursbuch
    nginx -t
    systemctl reload nginx
    echo "==> TLS-Zertifikat (Let's Encrypt)"
    certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN" ;;
  apache)
    echo "==> Apache: virtueller Host für $DOMAIN"
    a2enmod -q proxy proxy_http headers >/dev/null
    sed "s/__DOMAIN__/$DOMAIN/g" "$APP/deploy/apache.conf.template" > /etc/apache2/sites-available/kursbuch.conf
    a2ensite -q kursbuch >/dev/null
    apachectl configtest
    systemctl reload apache2
    echo "==> TLS-Zertifikat (Let's Encrypt)"
    certbot --apache --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN" ;;
  none)
    echo "==> Webserver-Einrichtung übersprungen (SKIP_WEB=1)" ;;
esac

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "==> Firewall (ufw ist aktiv): HTTP/HTTPS freigeben"
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

echo
echo "Fertig: https://$DOMAIN"
echo "Logs:   journalctl -u kursbuch -f"
