"""FastAPI-Anwendung: REST-API unter ``/api`` und statisches Frontend."""

from __future__ import annotations

import logging
import re

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import auth
from .config import settings
from .db import Database
from .providers.base import RANGES, ProviderError
from .providers.demo import DemoProvider
from .providers.yahoo import YahooProvider
from .service import MarketService
from .universe import ASSET_CLASSES, classify

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("kursbuch")

provider = DemoProvider() if settings.data_provider == "demo" else YahooProvider()
service = MarketService(provider)
db = Database(settings.data_dir / "kursbuch.sqlite3")
throttle = auth.LoginThrottle()

app = FastAPI(title="Kursbuch", docs_url=None, redoc_url=None, openapi_url=None)

SYMBOL_RE = re.compile(r"^[A-Za-z0-9^=.\-]{1,24}$")
PUBLIC_PATHS = {"/api/login", "/api/health"}

CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; "
       "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


def _symbol(s: str) -> str:
    s = s.strip().upper()
    if not SYMBOL_RE.match(s):
        raise HTTPException(400, "Ungültiges Symbol")
    return s


def symbol_param(s: str = Query(..., max_length=24)) -> str:
    return _symbol(s)


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path not in PUBLIC_PATHS:
        if not auth.verify_session(request.cookies.get(auth.COOKIE_NAME), settings.secret_key):
            return JSONResponse({"detail": "Nicht angemeldet"}, status_code=401)
        # CSRF-Schutz: zusätzlich zu SameSite=Strict verlangen schreibende Aufrufe einen Header,
        # den ein fremdes Formular nicht setzen kann.
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.headers.get("x-kursbuch") != "1":
            return JSONResponse({"detail": "Fehlender Anfrage-Header"}, status_code=403)
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(ProviderError)
async def provider_error(_: Request, exc: ProviderError):
    return JSONResponse({"detail": str(exc)}, status_code=502)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# --------------------------------------------------------------------- Auth
class LoginBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)


@app.post("/api/login")
def login(body: LoginBody, request: Request, response: Response):
    ip = client_ip(request)
    if not settings.password_hash:
        raise HTTPException(503, "Kein Passwort konfiguriert (DASHBOARD_PASSWORD_HASH fehlt)")
    if throttle.blocked(ip):
        raise HTTPException(429, "Zu viele Fehlversuche – bitte 15 Minuten warten")
    if not auth.verify_password(body.password, settings.password_hash):
        throttle.fail(ip)
        log.warning("Fehlgeschlagener Login von %s", ip)
        raise HTTPException(401, "Falsches Passwort")
    throttle.reset(ip)
    response.set_cookie(auth.COOKIE_NAME, auth.create_session(settings.secret_key, settings.session_days),
                        max_age=settings.session_days * 86400, httponly=True,
                        secure=settings.cookie_secure, samesite="strict", path="/")
    return {"ok": True}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/meta")
def meta():
    return {"provider": provider.name, "demo": provider.is_demo, "delay_note": provider.delay_note,
            "asset_classes": [{"key": k, "title": v} for k, v in ASSET_CLASSES.items()],
            "ranges": list(RANGES)}


# --------------------------------------------------------------------- Märkte
@app.get("/api/market")
def market():
    return {"items": service.market_strip()}


@app.get("/api/top/{asset_class}")
def top(asset_class: str, screen: str | None = None):
    try:
        return service.top(asset_class, screen)
    except KeyError:
        raise HTTPException(404, "Unbekannte Anlageklasse") from None


@app.get("/api/search")
def search(q: str = Query("", max_length=64)):
    return {"items": service.search(q)}


@app.get("/api/instrument")
def instrument(s: str = Depends(symbol_param)):
    return service.instrument(s)


@app.get("/api/chart")
def chart(s: str = Depends(symbol_param), range: str = "1J"):  # noqa: A002
    try:
        return service.chart(s, range)
    except KeyError:
        raise HTTPException(400, "Unbekannter Zeitraum") from None


@app.get("/api/analysis")
def analysis(s: str = Depends(symbol_param)):
    return service.analysis(s)


@app.get("/api/options")
def options(s: str = Depends(symbol_param), expiry: str | None = Query(None, max_length=10)):
    return service.options(s, expiry)


# ------------------------------------------------------------------ Sammlung
class CollectionBody(BaseModel):
    symbol: str
    name: str | None = Field(None, max_length=120)

    @field_validator("symbol")
    @classmethod
    def check_symbol(cls, v: str) -> str:
        v = v.strip().upper()
        if not SYMBOL_RE.match(v):
            raise ValueError("Ungültiges Symbol")
        return v


@app.get("/api/collection")
def collection():
    items = db.collection()
    quotes = service.quotes([i["symbol"] for i in items])
    held = {p["symbol"] for p in db.positions()}
    out = []
    for item in items:
        q = quotes.get(item["symbol"]) or {}
        out.append({**item, "price": q.get("price"), "change_pct": q.get("change_pct"),
                    "currency": q.get("currency"), "is_yield": q.get("is_yield", False),
                    "held": item["symbol"] in held})
    return {"items": out}


@app.post("/api/collection")
def add_collection(body: CollectionBody):
    q = service.quote(body.symbol)
    if q is None:
        raise HTTPException(404, "Symbol nicht gefunden")
    db.add_to_collection(body.symbol, body.name or q.get("name") or body.symbol,
                         classify(body.symbol, q.get("quote_type")))
    return {"ok": True}


@app.delete("/api/collection")
def remove_collection(s: str = Depends(symbol_param)):
    db.remove_from_collection(s)
    return {"ok": True}


# --------------------------------------------------------------------- Depot
class PositionBody(BaseModel):
    symbol: str
    quantity: float = Field(gt=0, lt=1e12)
    price: float = Field(ge=0, lt=1e12)
    bought_on: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")

    @field_validator("symbol")
    @classmethod
    def check_symbol(cls, v: str) -> str:
        return CollectionBody.check_symbol(v)


@app.get("/api/portfolio")
def portfolio():
    return service.portfolio(db.positions())


@app.get("/api/portfolio/chart")
def portfolio_chart(range: str = "1J"):  # noqa: A002
    try:
        return service.portfolio_chart(db.positions(), range)
    except KeyError:
        raise HTTPException(400, "Unbekannter Zeitraum") from None


@app.post("/api/positions")
def add_position(body: PositionBody):
    q = service.quote(body.symbol)
    if q is None:
        raise HTTPException(404, "Symbol nicht gefunden")
    pid = db.add_position(body.symbol, body.quantity, body.price, body.bought_on)
    # Gehaltene Werte erscheinen automatisch auch in der Sammlung.
    db.add_to_collection(body.symbol, q.get("name") or body.symbol, classify(body.symbol, q.get("quote_type")))
    return {"ok": True, "id": pid}


@app.delete("/api/positions/{position_id}")
def delete_position(position_id: int):
    if not db.delete_position(position_id):
        raise HTTPException(404, "Position nicht gefunden")
    return {"ok": True}


# ------------------------------------------------------------------ Frontend
FRONTEND = settings.frontend_dir
if (FRONTEND / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    if path in {"favicon.svg", "manifest.webmanifest"} and (FRONTEND / path).is_file():
        return FileResponse(FRONTEND / path)
    return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-cache"})
