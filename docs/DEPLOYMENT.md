# Deployment auf einem bestehenden nginx-Server (manuell)

Diese Anleitung geht davon aus, dass auf dem VPS bereits **nginx** (mit WordPress),
eine **Firewall**, **fail2ban** und **Let's-Encrypt-Zertifikate** eingerichtet sind.
Es gibt bewusst **kein Installationsskript**: Jeder Schritt wird von dir ausgeführt,
und bei jedem Schritt steht dabei, was er am System verändert.

Ersetze überall `dashboard.EIGENE-DOMAIN.de` durch deine Subdomain.

| Was | Wo | Neu oder geändert |
| --- | --- | --- |
| Systembenutzer `trading-board` | `/etc/passwd` | neu |
| Programmcode + Python-venv | `/opt/trading-board` | neu |
| Daten (SQLite, Cache) | `/var/lib/trading-board` | neu |
| Passwort-Hash, Schlüssel | `/etc/trading-board/trading-board.env` | neu |
| Dienst | `/etc/systemd/system/trading-board.service` | neu |
| nginx-Site | `/etc/nginx/sites-available/trading-board` (+ Symlink) | neu |
| ACME-Webroot | `/var/www/letsencrypt` | neu (falls nicht vorhanden) |
| Zertifikat | `/etc/letsencrypt/live/dashboard.…` | neu |
| fail2ban (optional) | `filter.d/trading-board.conf`, `jail.d/trading-board.local` | neu |

Bestehende Dateien (WordPress-Sites, `nginx.conf`, Firewall-Regeln, vorhandene
fail2ban-Jails, Zertifikate) werden nicht verändert. Der Dienst lauscht nur auf
`127.0.0.1:8710`, deshalb ist **keine Firewall-Änderung** nötig.

---

## 0. Vorab prüfen

```bash
# DNS: muss die IP des Hostinger-VPS liefern (dieselbe wie die WordPress-Domain)
dig +short dashboard.EIGENE-DOMAIN.de
dig +short EIGENE-DOMAIN.de

python3 --version                 # >= 3.10
nginx -v                          # 1.18/1.24: Vorlage passt; ab 1.25.1 siehe Kommentar zu http2
sudo ss -ltn 'sport = :8710'      # muss leer sein (Port frei)
```

**DNS bei Strato:** Die Subdomain braucht einen **A-Record** (bei IPv6 zusätzlich
`AAAA`) auf die VPS-IP, einzutragen unter *Domains → Verwalten → DNS → A-Record*.
Eine Strato-„Weiterleitung“ bzw. „Umleitung“ (HTTP-Redirect oder Frame) funktioniert
**nicht**: Dabei antwortet ein Strato-Server statt deines VPS, und das Zertifikat
kann nicht ausgestellt werden. Nach einer Änderung kann es je nach TTL bis zu einigen
Stunden dauern, bis `dig` die neue IP liefert.

## 1. Pakete (nur falls noch nicht vorhanden)

```bash
sudo apt-get install python3-venv git
```

## 2. Systembenutzer und Verzeichnisse

Der Dienst läuft unter einem eigenen Benutzer ohne Login-Shell.

```bash
sudo useradd --system --home /var/lib/trading-board --shell /usr/sbin/nologin trading-board
sudo install -d -o trading-board -g trading-board -m 750 /var/lib/trading-board /var/lib/trading-board/cache
sudo install -d -m 750 /etc/trading-board
```

## 3. Code und Python-Umgebung

```bash
sudo git clone https://github.com/Chris93WuVa/trading_agent.git /opt/trading-board
sudo python3 -m venv /opt/trading-board/venv
sudo /opt/trading-board/venv/bin/pip install --upgrade pip
sudo /opt/trading-board/venv/bin/pip install -r /opt/trading-board/backend/requirements.txt
```

Der Code gehört `root`; der Dienstbenutzer darf ihn nur lesen.

## 4. Passwort und Schlüssel

```bash
# Fragt das Dashboard-Passwort ab (mind. 10 Zeichen) und gibt NUR den scrypt-Hash aus
cd /opt/trading-board/backend && sudo /opt/trading-board/venv/bin/python -m app.auth

# Zufälligen Signaturschlüssel für Sitzungs-Cookies erzeugen
/opt/trading-board/venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Beide Werte in `/etc/trading-board/trading-board.env` eintragen (z. B. mit `sudo nano`):

```ini
DASHBOARD_PASSWORD_HASH=scrypt:32768:8:1:...
SECRET_KEY=...
DATA_PROVIDER=yahoo
DATA_DIR=/var/lib/trading-board
FRONTEND_DIR=/opt/trading-board/frontend
COOKIE_SECURE=1
SESSION_DAYS=14
```

```bash
sudo chown root:trading-board /etc/trading-board/trading-board.env
sudo chmod 640 /etc/trading-board/trading-board.env
```

## 5. Dienst (systemd)

Vorher `deploy/trading-board.service` lesen. Die Unit startet uvicorn auf `127.0.0.1:8710`
mit Sandboxing: nur `/var/lib/trading-board` ist beschreibbar.

```bash
sudo cp /opt/trading-board/deploy/trading-board.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now trading-board
systemctl status trading-board --no-pager
curl -s http://127.0.0.1:8710/api/health          # -> {"ok":true}
```

## 6. Zertifikat holen

Das Zertifikat wird per **HTTP-01-Challenge** (ACME, RFC 8555) ausgestellt: Let's
Encrypt ruft `http://dashboard.…/.well-known/acme-challenge/<token>` ab. Dafür braucht
nginx zuerst einen Port-80-Block für die Subdomain.

**6a. Vorläufige Site nur mit Port 80** anlegen, als `/etc/nginx/sites-available/trading-board`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name dashboard.EIGENE-DOMAIN.de;
    location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 404; }
}
```

```bash
sudo install -d /var/www/letsencrypt
sudo ln -s /etc/nginx/sites-available/trading-board /etc/nginx/sites-enabled/trading-board
sudo nginx -t && sudo systemctl reload nginx
```

**6b. Zertifikat anfordern.** `certonly` holt nur das Zertifikat und ändert **keine**
nginx-Dateien:

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt \
     -d dashboard.EIGENE-DOMAIN.de --deploy-hook "systemctl reload nginx"
sudo certbot renew --dry-run      # Verlängerung testen
```

Die Verlängerung übernimmt der vorhandene `certbot.timer` (`systemctl list-timers | grep certbot`),
etwa 30 Tage vor Ablauf der 90-Tage-Gültigkeit. Der `--deploy-hook` wird in
`/etc/letsencrypt/renewal/dashboard.….conf` gespeichert und lädt nginx nach jeder
Erneuerung neu.

> Wenn du die WordPress-Zertifikate anders verwaltest (z. B. `certbot --nginx` oder acme.sh),
> kannst du für die Subdomain dasselbe Verfahren nutzen. Wichtig ist nur, dass die Pfade
> `ssl_certificate` und `ssl_certificate_key` in Schritt 7 stimmen.

## 7. Endgültige nginx-Site

`deploy/nginx-trading-board.conf` lesen, die Subdomain ersetzen und den Inhalt nach
`/etc/nginx/sites-available/trading-board` übernehmen (ersetzt die vorläufige Datei aus 6a).
Optional deine vorhandenen TLS-Einstellungen per `include` einbinden (in der Vorlage kommentiert).

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://dashboard.EIGENE-DOMAIN.de | head -5
```

Was die Datei enthält:
* **Port 80:** liefert nur ACME-Challenges aus und leitet alles andere auf HTTPS um.
* **Port 443:** TLS, HSTS (nur für die Subdomain), Weiterleitung an `127.0.0.1:8710`,
  Login-Drosselung (`limit_req`, 10/min), eigene Logdateien `trading-board_*.log`.
* Den Hostnamen der Anfrage (`server_name`) erkennt nginx über Host-Header bzw. SNI.
  Deshalb können WordPress und das Dashboard auf derselben IP und denselben Ports laufen.

## 8. fail2ban (optional)

Die App protokolliert Fehlversuche mit echter Client-IP im Journal. Eine passende
Filter- und Jail-Vorlage steht in `deploy/fail2ban-trading-board.conf`.

```bash
sudo fail2ban-regex systemd-journal /etc/fail2ban/filter.d/trading-board.conf
sudo fail2ban-client reload && sudo fail2ban-client status trading-board
```

## 9. Funktionstest

1. `https://dashboard.EIGENE-DOMAIN.de` aufrufen und anmelden.
2. Märkte → Aktien: Kurse müssen erscheinen (kein Hinweis „Demo-Daten“).
3. Bei Problemen: `journalctl -u trading-board -f` und `/var/log/nginx/trading-board_error.log`.
4. Prüfen, ob die WordPress-Seite unverändert erreichbar ist.

---

## Updates

```bash
cd /opt/trading-board
sudo git pull
sudo /opt/trading-board/venv/bin/pip install -r backend/requirements.txt
sudo systemctl restart trading-board
curl -s http://127.0.0.1:8710/api/health
```

Hat sich `deploy/trading-board.service` oder `deploy/nginx-trading-board.conf` geändert
(`git log -p -- deploy/` zeigt es), übernimmst du die Änderung selbst.

## Backup

Alle Nutzerdaten liegen in einer Datei:
`/var/lib/trading-board/trading-board.sqlite3`. Sicherung im laufenden Betrieb (Paket `sqlite3`):

```bash
sudo -u trading-board sqlite3 /var/lib/trading-board/trading-board.sqlite3 ".backup '/var/lib/trading-board/backup.sqlite3'"
```

## Passwort ändern

Neuen Hash wie in Schritt 4 erzeugen, in `trading-board.env` ersetzen und dann
`sudo systemctl restart trading-board` ausführen.

## Vollständig entfernen

```bash
sudo systemctl disable --now trading-board
sudo rm /etc/systemd/system/trading-board.service /etc/nginx/sites-enabled/trading-board /etc/nginx/sites-available/trading-board
sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name dashboard.EIGENE-DOMAIN.de
sudo rm -r /opt/trading-board /etc/trading-board /var/lib/trading-board
sudo userdel trading-board
```
