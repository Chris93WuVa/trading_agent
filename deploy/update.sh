#!/usr/bin/env bash
# Neue Version einspielen:  cd ~/trading_agent && git pull && sudo bash deploy/update.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Bitte mit sudo ausführen."; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/kursbuch
rsync -a --delete --exclude '.git' --exclude 'var' --exclude '.env' --exclude '__pycache__' --exclude 'venv' "$SRC/" "$APP/"
"$APP/venv/bin/pip" install -q -r "$APP/backend/requirements.txt"
install -m 644 "$APP/deploy/kursbuch.service" /etc/systemd/system/kursbuch.service
systemctl daemon-reload
systemctl restart kursbuch
sleep 2
curl -fsS http://127.0.0.1:8710/api/health && echo " – Kursbuch läuft."
