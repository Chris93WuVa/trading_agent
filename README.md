# Kursbuch

Privates Trading-Dashboard für Aktien, ETFs, Fonds, Anleihen, Währungen, Krypto,
Derivate (Futures, Optionsketten) und Indizes – aufgebaut wie Trade Republic: Depot
mit großem Wert und Chart, Suche, Top-Listen je Anlageklasse und eine Detailseite mit
Kennzahlen und einer nachvollziehbaren Einschätzung **Kaufen / Halten / Verkaufen**.

Das Design orientiert sich an einem Kursblatt aus Papier: Haarlinien statt Kacheln,
Serifen-Ziffern für große Werte, Monospace für Tabellen und eine einzige Akzentfarbe.
Hell- und Dunkelmodus, auch für Mobilgeräte.

## Funktionen

* **Suche** über alle Anlageklassen (Yahoo Finance), Tastenkürzel `/` oder `⌘K`
* **Top-Listen** je Klasse (kuratiert für Anleger in Deutschland) plus dynamische
  US-Listen: meistgehandelt, Tagesgewinner, Tagesverlierer
* **Sammlung** (Watchlist): Werte mit dem Stern hinzufügen oder entfernen
* **Depot**: Käufe mit Stückzahl, Kaufkurs und Datum erfassen; Wert in EUR mit
  Devisenumrechnung, Tages- und Gesamt-G/V, Aufteilung nach Anlageklasse, Wertverlauf
* **Chart** 1T · 1W · 1M · 6M · 1J · 5J · MAX mit Fadenkreuz (Wert oben folgt dem Finger)
* **Kennzahlen**: Performance, Volatilität, Drawdown, Sharpe, Sortino, Beta, SMA,
  RSI, MACD, Bollinger, ATR, Momentum, Fundamentaldaten, Analystenkonsens
* **Einschätzung** aus sieben literaturgestützten Faktoren inkl. Begründung,
  Konsistenz, Datenabdeckung und volatilitätsbasierten Stop-/Zielmarken
* **Trendregel im Rückblick**: SMA-200-Regel vs. Kaufen & Halten (ohne Look-ahead, mit Kosten)
* **Optionsketten** für US-Aktien und US-ETFs
* **Methodik-Seite** mit allen Formeln und 25 Quellen (DOI) – siehe [`docs/METHODIK.md`](docs/METHODIK.md)

> Die Einschätzung ist eine strukturierte, regelbasierte Auswertung und keine
> Anlageberatung. Grenzen der Methode sind in der Methodik beschrieben.

## Architektur

```
Browser ──HTTPS──▶ nginx/Apache (TLS) ──▶ uvicorn/FastAPI (127.0.0.1:8710)
                                                ├─ /api/*   REST, Login per Session-Cookie
                                                ├─ /        Frontend (HTML/CSS/JS, ohne Build)
                                                ├─ SQLite   Sammlung & Positionen
                                                └─ yfinance Kurse, Historie, Stammdaten (gecacht)
```

* `backend/app/` – FastAPI-App, Analytik, Signal, Provider (Yahoo / Demo), SQLite
* `frontend/` – Single-Page-App ohne Abhängigkeiten; Schriften selbst gehostet
  (Instrument Sans/Serif, IBM Plex Mono, SIL OFL), keine Verbindungen zu Drittanbietern
* `deploy/` – Installer, Update-Skript, systemd-Unit, nginx- und Apache-Vorlage

**Sicherheit:** Passwort als scrypt-Hash, signiertes HttpOnly-/Secure-/SameSite-Strict-Cookie,
Login-Drosselung (App + nginx), CSRF-Header für schreibende Aufrufe, strikte
Content-Security-Policy, systemd-Sandboxing.

## Installation auf dem Hostinger-VPS (Ubuntu)

Kursbuch läuft als eigener Dienst auf `127.0.0.1:8710` (von außen nicht erreichbar).
Der vorhandene Webserver auf Port 80/443 nimmt Anfragen für die Subdomain entgegen und
leitet sie weiter (Reverse-Proxy). Eine bestehende WordPress-Seite auf der Hauptdomain
bleibt unverändert: Der Webserver unterscheidet die Seiten am angefragten Hostnamen.

1. **DNS:** Im Hostinger-Panel (Domains → DNS-Zone) einen `A`-Record
   `dashboard` → IP deines VPS anlegen (bei IPv6 zusätzlich `AAAA`). Prüfen:
   `dig +short dashboard.EIGENE-DOMAIN.de`
2. **Per SSH einloggen** und Repository holen:
   ```bash
   ssh root@<VPS-IP>
   git clone https://github.com/Chris93WuVa/trading_agent.git
   cd trading_agent
   ```
3. **Installer starten** (fragt das Dashboard-Passwort ab, mind. 10 Zeichen):
   ```bash
   sudo bash deploy/install.sh dashboard.EIGENE-DOMAIN.de deine@mail.de
   ```
   Der Installer erkennt, ob auf Port 80 **nginx** oder **Apache** läuft, legt dort einen
   zusätzlichen virtuellen Host nur für die Subdomain an und holt per certbot ein
   Let's-Encrypt-Zertifikat (Verlängerung automatisch über den certbot-Timer). Läuft
   ein anderer Webserver (z. B. OpenLiteSpeed/CyberPanel), bricht er ab, bevor etwas
   verändert wird. Dann im Panel einen Reverse-Proxy `dashboard.…` → `http://127.0.0.1:8710`
   anlegen und den Installer mit `SKIP_WEB=1` erneut starten.
4. Fertig: `https://dashboard.EIGENE-DOMAIN.de`

Vor der Installation prüfen, welcher Webserver läuft: `sudo ss -ltnp 'sport = :80'`.

**Updates:** `cd ~/trading_agent && git pull && sudo bash deploy/update.sh`
**Logs:** `journalctl -u kursbuch -f`
**Passwort ändern:** `cd /opt/kursbuch/backend && sudo /opt/kursbuch/venv/bin/python -m app.auth`,
Ausgabe in `/etc/kursbuch/kursbuch.env` bei `DASHBOARD_PASSWORD_HASH` eintragen,
`sudo systemctl restart kursbuch`.
**Backup:** `/var/lib/kursbuch/kursbuch.sqlite3` sichern.

## Lokal entwickeln

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp ../.env.example ../.env          # Hash mit `python -m app.auth` erzeugen und eintragen
uvicorn app.main:app --reload       # http://127.0.0.1:8000
pytest -q
```

Mit `DATA_PROVIDER=demo` läuft alles offline mit synthetischen Kursen (im UI als
„Demo-Daten“ markiert).

## Daten

Yahoo Finance über [`yfinance`](https://github.com/ranaroussi/yfinance). Es gibt keine
offizielle API; Kurse sind je nach Börse bis zu 20 Minuten verzögert, Ausfälle sind
möglich. Die Daten sind nur für private Nutzung bestimmt. Einzelanleihen und
Hebelprodukte (Optionsscheine, Knock-outs) sind über freie Quellen nicht verfügbar;
Anleihen werden über Renditen und Anleihe-ETFs abgebildet.

Symbole folgen der Yahoo-Schreibweise: `SAP.DE` (Xetra), `EUNL.DE`, `EURUSD=X`,
`BTC-EUR`, `GC=F` (Gold-Future), `^GDAXI` (DAX).
