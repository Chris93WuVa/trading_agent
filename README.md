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
Browser ──HTTPS──▶ nginx (TLS)          ──▶ uvicorn/FastAPI (127.0.0.1:8710)
                                                ├─ /api/*   REST, Login per Session-Cookie
                                                ├─ /        Frontend (HTML/CSS/JS, ohne Build)
                                                ├─ SQLite   Sammlung & Positionen
                                                └─ yfinance Kurse, Historie, Stammdaten (gecacht)
```

* `backend/app/` – FastAPI-App, Analytik, Signal, Provider (Yahoo / Demo), SQLite
* `frontend/` – Single-Page-App ohne Abhängigkeiten; Schriften selbst gehostet
  (Instrument Sans/Serif, IBM Plex Mono, SIL OFL), keine Verbindungen zu Drittanbietern
* `deploy/` – Vorlagen für systemd, nginx und fail2ban (manuelle Einrichtung)

**Sicherheit:** Passwort als scrypt-Hash, signiertes HttpOnly-/Secure-/SameSite-Strict-Cookie,
Login-Drosselung (App + nginx), CSRF-Header für schreibende Aufrufe, strikte
Content-Security-Policy, systemd-Sandboxing.

## Installation auf dem VPS

Kursbuch läuft als eigener Dienst auf `127.0.0.1:8710` und ist von außen nicht direkt
erreichbar. Der vorhandene nginx nimmt Anfragen für die Subdomain entgegen und leitet
sie weiter (Reverse-Proxy). Die WordPress-Seite auf der Hauptdomain bleibt unverändert,
denn nginx unterscheidet die Seiten am angefragten Hostnamen.

Es gibt **kein Installationsskript**. Alle Schritte führst du selbst aus; jeder ist
mit seinen Auswirkungen beschrieben in **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**:
DNS bei Strato, Systembenutzer, Python-venv, systemd-Dienst, nginx-Site, Zertifikat
per `certbot certonly --webroot` (ändert keine nginx-Dateien), optional fail2ban,
Updates, Backup und Deinstallation.

Vorlagen in `deploy/`:
* `kursbuch.service` – systemd-Unit (uvicorn, Sandboxing)
* `nginx-kursbuch.conf` – Server-Blöcke nur für die Subdomain (Port 80 → HTTPS, Port 443 → App)
* `fail2ban-kursbuch.conf` – Filter und Jail für fehlgeschlagene Logins

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
