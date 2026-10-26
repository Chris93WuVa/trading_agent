def test_requires_login(client):
    assert client.get("/api/meta").status_code in (200, 401)
    fresh = client.__class__(client.app)
    assert fresh.get("/api/meta").status_code == 401
    assert fresh.post("/api/login", json={"password": "falsch"}).status_code == 401


def test_csrf_header_required(authed):
    r = authed.post("/api/collection", json={"symbol": "SAP.DE"})
    assert r.status_code == 403


def test_top_lists_and_search(authed):
    meta = authed.get("/api/meta").json()
    assert meta["demo"] is True
    for cls in [c["key"] for c in meta["asset_classes"]]:
        data = authed.get(f"/api/top/{cls}").json()
        assert data["items"], cls
    hits = authed.get("/api/search?q=siemens").json()["items"]
    assert hits[0]["symbol"] == "SIE.DE"


def test_instrument_chart_analysis(authed):
    assert authed.get("/api/instrument?s=SAP.DE").json()["quote"]["currency"] == "EUR"
    for rng in ["1T", "1W", "1M", "6M", "1J", "5J", "MAX"]:
        assert authed.get(f"/api/chart?s=SAP.DE&range={rng}").json()["points"]
    a = authed.get("/api/analysis?s=SAP.DE").json()
    assert a["signal"]["label"] in {"Kaufen", "Halten", "Verkaufen"}
    assert a["backtest"]["equity"]
    assert authed.get("/api/instrument?s=bad<sym").status_code == 400


def test_collection_and_portfolio_roundtrip(authed):
    h = {"X-Kursbuch": "1"}
    assert authed.post("/api/collection", json={"symbol": "NVDA"}, headers=h).status_code == 200
    assert "NVDA" in [i["symbol"] for i in authed.get("/api/collection").json()["items"]]
    r = authed.post("/api/positions", json={"symbol": "AAPL", "quantity": 2, "price": 10}, headers=h)
    pid = r.json()["id"]
    pf = authed.get("/api/portfolio").json()
    aapl = next(x for x in pf["holdings"] if x["symbol"] == "AAPL")
    assert aapl["quantity"] == 2 and aapl["value_eur"] > 0
    assert authed.get("/api/portfolio/chart?range=1J").json()["points"]
    assert authed.delete(f"/api/positions/{pid}", headers=h).status_code == 200
    assert authed.delete("/api/collection?s=NVDA", headers=h).status_code == 200
    bad = {"symbol": "AAPL", "quantity": -1, "price": 1}
    assert authed.post("/api/positions", json=bad, headers=h).status_code == 422


def test_frontend_served_with_csp(client):
    r = client.get("/")
    assert r.status_code == 200 and "Kursbuch" in r.text
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
