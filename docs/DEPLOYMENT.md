# Deployment auf einem bestehenden nginx-Server (manuell)

Diese Anleitung geht davon aus, dass auf dem VPS bereits **nginx** (mit WordPress),
eine **Firewall**, **fail2ban** und **Let's-Encrypt-Zertifikate** eingerichtet sind.
Es gibt bewusst **kein Installationsskript**: Jeder Schritt wird von dir ausgeführt,
und bei jedem Schritt steht dabei, was er am System verändert.

Ersetze überall `dashboard.EIGENE-DOMAIN.de` durch deine Subdomain.

| Was | Wo | Neu oder geändert |
| --- | --- | --- |
| Systembenutzer `kursbuch` | `/etc/passwd` | neu |
| Programmcode + Python-venv | `/opt/kursbuch` | neu |
| Daten (SQLite, Cache) | `/var/lib/kursbuch` | neu |
| Passwort-Hash, Schlüssel | `/etc/kursbuch/kursbuch.env` | neu |
| Dienst | `/etc/systemd/system/kursbuch.service` | neu |
| nginx-Site | `/etc/nginx/sites-available/kursbuch` (+ Symlink) | neu |
| ACME-Webroot | `/var/www/letsencrypt` | neu (falls nicht vorhanden) |
| Zertifikat | `/etc/letsencrypt/live/dashboard.…` | neu |
| fail2ban (optional) | `filter.d/kursbuch.conf`, `jail.d/kursbuch.local` | neu |

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
sudo useradd --system --home /var/lib/kursbuch --shell /usr/sbin/nologin kursbuch
sudo install -d -o kursbuch -g kursbuch -m 750 /var/lib/kursbuch /var/lib/kursbuch/cache
sudo install -d -m 750 /etc/kursbuch
```

## 3. Code und Python-Umgebung

```bash
sudo git clone https://github.com/Chris93WuVa/trading_agent.git /opt/kursbuch
sudo python3 -m venv /opt/kursbuch/venv
sudo /opt/kursbuch/venv/bin/pip install --upgrade pip
sudo /opt/kursbuch/venv/bin/pip install -r /opt/kursbuch/backend/requirements.txt
```

Der Code gehört `root`; der Dienstbenutzer darf ihn nur lesen.

## 4. Passwort und Schlüssel

```bash
# Fragt das Dashboard-Passwort ab (mind. 10 Zeichen) und gibt NUR den scrypt-Hash aus
cd /opt/kursbuch/backend && sudo /opt/kursbuch/venv/bin/python -m app.auth

# Zufälligen Signaturschlüssel für Sitzungs-Cookies erzeugen
/opt/kursbuch/venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Beide Werte in `/etc/kursbuch/kursbuch.env` eintragen (z. B. mit `sudo nano`):

```ini
DASHBOARD_PASSWORD_HASH=scrypt:32768:8:1:...
SECRET_KEY=...
DATA_PROVIDER=yahoo
DATA_DIR=/var/lib/kursbuch
FRONTEND_DIR=/opt/kursbuch/frontend
COOKIE_SECURE=1
SESSION_DAYS=14
```

```bash
sudo chown root:kursbuch /etc/kursbuch/kursbuch.env
sudo chmod 640 /etc/kursbuch/kursbuch.env
```

## 5. Dienst (systemd)

Vorher `deploy/kursbuch.service` lesen. Die Unit startet uvicorn auf `127.0.0.1:8710`
mit Sandboxing: nur `/var/lib/kursbuch` ist beschreibbar.

```bash
sudo cp /opt/kursbuch/deploy/kursbuch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kursbuch
systemctl status kursbuch --no-pager
curl -s http://127.0.0.1:8710/api/health          # -> {"ok":true}
```

## 6. Zertifikat holen

Das Zertifikat wird per **HTTP-01-Challenge** (ACME, RFC 8555) ausgestellt: Let's
Encrypt ruft `http://dashboard.…/.well-known/acme-challenge/<token>` ab. Dafür braucht
nginx zuerst einen Port-80-Block für die Subdomain.

**6a. Vorläufige Site nur mit Port 80** anlegen, als `/etc/nginx/sites-available/kursbuch`:

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
sudo ln -s /etc/nginx/sites-available/kursbuch /etc/nginx/sites-enabled/kursbuch
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

`deploy/nginx-kursbuch.conf` lesen, die Subdomain ersetzen und den Inhalt nach
`/etc/nginx/sites-available/kursbuch` übernehmen (ersetzt die vorläufige Datei aus 6a).
Optional deine vorhandenen TLS-Einstellungen per `include` einbinden (in der Vorlage kommentiert).

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://dashboard.EIGENE-DOMAIN.de | head -5
```

Was die Datei enthält:
* **Port 80:** liefert nur ACME-Challenges aus und leitet alles andere auf HTTPS um.
* **Port 443:** TLS, HSTS (nur für die Subdomain), Weiterleitung an `127.0.0.1:8710`,
  Login-Drosselung (`limit_req`, 10/min), eigene Logdateien `kursbuch_*.log`.
* Den Hostnamen der Anfrage (`server_name`) erkennt nginx über Host-Header bzw. SNI.
  Deshalb können WordPress und das Dashboard auf derselben IP und denselben Ports laufen.

## 8. fail2ban (optional)

Die App protokolliert Fehlversuche mit echter Client-IP im Journal. Eine passende
Filter- und Jail-Vorlage steht in `deploy/fail2ban-kursbuch.conf`.

```bash
sudo fail2ban-regex systemd-journal /etc/fail2ban/filter.d/kursbuch.conf
sudo fail2ban-client reload && sudo fail2ban-client status kursbuch
```

## 9. Funktionstest

1. `https://dashboard.EIGENE-DOMAIN.de` aufrufen und anmelden.
2. Märkte → Aktien: Kurse müssen erscheinen (kein Hinweis „Demo-Daten“).
3. Bei Problemen: `journalctl -u kursbuch -f` und `/var/log/nginx/kursbuch_error.log`.
4. Prüfen, ob die WordPress-Seite unverändert erreichbar ist.

---

## Updates

```bash
cd /opt/kursbuch
sudo git pull
sudo /opt/kursbuch/venv/bin/pip install -r backend/requirements.txt
sudo systemctl restart kursbuch
curl -s http://127.0.0.1:8710/api/health
```

Hat sich `deploy/kursbuch.service` oder `deploy/nginx-kursbuch.conf` geändert
(`git log -p -- deploy/` zeigt es), übernimmst du die Änderung selbst.

## Backup

Alle Nutzerdaten liegen in einer Datei:
`/var/lib/kursbuch/kursbuch.sqlite3`. Sicherung im laufenden Betrieb (Paket `sqlite3`):

```bash
sudo -u kursbuch sqlite3 /var/lib/kursbuch/kursbuch.sqlite3 ".backup '/var/lib/kursbuch/backup.sqlite3'"
```

## Passwort ändern

Neuen Hash wie in Schritt 4 erzeugen, in `kursbuch.env` ersetzen und dann
`sudo systemctl restart kursbuch` ausführen.

## Vollständig entfernen

```bash
sudo systemctl disable --now kursbuch
sudo rm /etc/systemd/system/kursbuch.service /etc/nginx/sites-enabled/kursbuch /etc/nginx/sites-available/kursbuch
sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name dashboard.EIGENE-DOMAIN.de
sudo rm -r /opt/kursbuch /etc/kursbuch /var/lib/kursbuch
sudo userdel kursbuch
```
