"""Autonomous Türkiye economic-strain early warning from public data."""
from __future__ import annotations

import json, statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus
from xml.etree import ElementTree as ET

import requests

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "output.json"
FX_CACHE = ROOT / "data" / "fx_history.json"
TIMEOUT = 30
FALLBACK_HOURS = 72
UA = "MonarchCastleTech-TurkiyeRadar/2.0 (public research; github.com/MonarchCastleTech/tr-economic-sentiment)"
TCMB = "https://www.tcmb.gov.tr/kurlar"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv"
WEIGHTS = {"lira_dislocation": .30, "imported_energy": .25, "reserve_buffer": .20, "consumer_confidence": .15, "narrative_strain": .10}
SOURCES = [
    {"name": "TCMB", "role": "Official daily USD/TRY reference rates", "url": "https://www.tcmb.gov.tr/kurlar/kurlar_tr.html"},
    {"name": "FRED / U.S. EIA", "role": "Daily Brent crude series DCOILBRENTEU", "url": "https://fred.stlouisfed.org/series/DCOILBRENTEU"},
    {"name": "FRED / IMF", "role": "Monthly reserves excluding gold, TRESEGTRM052N", "url": "https://fred.stlouisfed.org/series/TRESEGTRM052N"},
    {"name": "FRED / OECD", "role": "Monthly consumer confidence, CSCICP02TRM460S", "url": "https://fred.stlouisfed.org/series/CSCICP02TRM460S"},
    {"name": "Google News RSS", "role": "Deterministic Turkish economic-stress narrative sample", "url": "https://news.google.com/rss"},
]
DISTRESS = {"kriz": 2.0, "temerrüt": 3.0, "iflas": 2.0, "işsizlik": 1.5, "zam": .6, "enflasyon": .8, "devalüasyon": 2.5, "döviz şoku": 2.5, "kur şoku": 2.5, "rezerv kaybı": 2.0, "sermaye çıkışı": 2.0, "likidite": .7, "daralma": 1.4, "resesyon": 1.8, "risk primi": 1.2, "faiz artışı": 1.0, "pahalılık": .9}

def clamp(v: float, lo: float = 0, hi: float = 100) -> float: return max(lo, min(hi, v))
def num(v: Any) -> float:
    try: return float(v)
    except (TypeError, ValueError): return 0.0
def pdate(v: Any) -> date | None:
    try: return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError): return None
def pdt(v: Any) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00")); return d.replace(tzinfo=d.tzinfo or timezone.utc).astimezone(timezone.utc)
    except (TypeError, ValueError): return None
def robust_z(current: float, baseline: list[float]) -> float:
    if len(baseline) < 6: return 0.0
    med = statistics.median(baseline); mad = statistics.median(abs(x - med) for x in baseline)
    if mad > 1e-9: return (current - med) / (1.4826 * mad)
    sd = statistics.pstdev(baseline); return (current - med) / sd if sd > 1e-9 else 0.0
def band(score: float) -> str: return "BASELINE" if score < 25 else "WATCH" if score < 45 else "ELEVATED" if score < 65 else "HIGH" if score < 80 else "SEVERE"
def anomaly(z: float) -> float: return clamp((max(0, z) - .5) / 2.5 * 100)
def get(url: str, **kwargs: Any) -> requests.Response:
    r = requests.get(url, headers={"User-Agent": UA, "Accept": "*/*"}, timeout=kwargs.pop("timeout", TIMEOUT), **kwargs); r.raise_for_status(); return r

def fx_one(day: date) -> tuple[date, float] | None:
    try:
        root = ET.fromstring(get(f"{TCMB}/{day:%Y%m}/{day:%d%m%Y}.xml", timeout=15).content); usd = root.find(".//Currency[@CurrencyCode='USD']"); value = num(usd.findtext("ForexBuying") if usd is not None else None)
        return (day, value) if value > 0 else None
    except (requests.RequestException, ET.ParseError): return None

def collect_fx_days(today: date, calendar_days: int = 190) -> list[tuple[date, float]]:
    cutoff = today - timedelta(days=calendar_days); cached: list[tuple[date, float]] = []
    try:
        cached = [(date.fromisoformat(x["date"]), num(x["value"])) for x in json.loads(FX_CACHE.read_text(encoding="utf-8")) if date.fromisoformat(x["date"]) >= cutoff]
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError): pass
    candidates = [today - timedelta(days=i) for i in range(calendar_days) if (today - timedelta(days=i)).weekday() < 5]
    days = candidates if len(cached) < 80 else candidates[:15]; rows: list[tuple[date, float]] = list(cached)
    with ThreadPoolExecutor(max_workers=12) as pool:
        for future in as_completed([pool.submit(fx_one, d) for d in days]):
            row = future.result()
            if row: rows.append(row)
    merged = sorted({d: v for d, v in rows if v > 0}.items()); FX_CACHE.write_text(json.dumps([{"date": d.isoformat(), "value": v} for d, v in merged], indent=2), encoding="utf-8"); return merged

def fred_series(series_id: str, calendar_days: int) -> list[tuple[date, float]]:
    lines = get(FRED, params={"id": series_id, "cosd": (date.today() - timedelta(days=calendar_days)).isoformat()}).text.splitlines(); rows = []
    for line in lines[1:]:
        parts = line.split(","); day = pdate(parts[0] if parts else None)
        if day and len(parts) > 1 and parts[1] not in ("", "."): rows.append((day, num(parts[1])))
    if len(rows) < 8: raise RuntimeError(f"Insufficient {series_id} history")
    return rows

def changes(values: list[float], lag: int = 1) -> list[float]: return [(values[i] / values[i-lag] - 1) * 100 for i in range(lag, len(values)) if values[i-lag] > 0]

def collect_lira(fx: list[tuple[date, float]]) -> dict[str, Any]:
    vals = [x[1] for x in fx]; ret5 = changes(vals, 5); ret1 = changes(vals); vols = [statistics.pstdev(ret1[i-19:i+1]) for i in range(19, len(ret1))]
    z_ret = robust_z(ret5[-1], ret5[-61:-1]); z_vol = robust_z(vols[-1], vols[-61:-1]); score = round(.65 * anomaly(z_ret) + .35 * anomaly(z_vol), 1)
    return {"key": "lira_dislocation", "score": score, "status": band(score), "weight": WEIGHTS["lira_dislocation"], "available": True, "retained": False, "coverage": len(fx), "latest_date": fx[-1][0].isoformat(), "latest_value": round(vals[-1], 4), "change_5d_pct": round(ret5[-1], 2), "return_z": round(z_ret, 2), "volatility_20d": round(vols[-1], 2), "volatility_z": round(z_vol, 2), "method": "65% one-week TRY depreciation anomaly + 35% 20-session volatility anomaly.", "evidence": [{"label": "USD/TRY reference rate", "value": round(vals[-1], 4), "date": fx[-1][0].isoformat(), "url": SOURCES[0]["url"]}]}

def align(fx: list[tuple[date, float]], oil: list[tuple[date, float]]) -> list[tuple[date, float]]:
    rates = dict(fx); return [(d, v * rates[d]) for d, v in oil if d in rates and rates[d] > 0]

def collect_energy(fx: list[tuple[date, float]]) -> dict[str, Any]:
    local = align(fx, fred_series("DCOILBRENTEU", 400))
    if len(local) < 50: raise RuntimeError("Insufficient aligned oil/FX history")
    vals = [x[1] for x in local]; ret = changes(vals, 5); z = robust_z(ret[-1], ret[-51:-1]); score = round(anomaly(z), 1)
    return {"key": "imported_energy", "score": score, "status": band(score), "weight": WEIGHTS["imported_energy"], "available": True, "retained": False, "coverage": len(local), "latest_date": local[-1][0].isoformat(), "latest_value": round(vals[-1], 1), "change_5d_pct": round(ret[-1], 2), "return_z": round(z, 2), "method": "Five-observation robust anomaly in Brent priced in TRY (Brent USD × USD/TRY).", "evidence": [{"label": "Brent in TRY proxy", "value": round(vals[-1], 1), "date": local[-1][0].isoformat(), "url": SOURCES[1]["url"]}]}

def monthly_pressure(rows: list[tuple[date, float]], adverse: int, key: str, weight: float, method: str, label: str, url: str) -> dict[str, Any]:
    vals = [x[1] for x in rows]; delta = changes(vals); adverse_delta = adverse * delta[-1]; z = robust_z(adverse_delta, [adverse * x for x in delta[-37:-1]]); three = adverse * (vals[-1] / vals[-4] - 1) * 100; score = round(.7 * anomaly(z) + .3 * clamp((three - 2) / 10 * 100), 1)
    return {"key": key, "score": score, "status": band(score), "weight": weight, "available": True, "retained": False, "coverage": len(rows), "latest_date": rows[-1][0].isoformat(), "latest_value": round(vals[-1], 2), "change_1m_pct": round(delta[-1], 2), "adverse_3m_pct": round(three, 2), "change_z": round(z, 2), "method": method, "evidence": [{"label": label, "value": round(vals[-1], 2), "date": rows[-1][0].isoformat(), "url": url}]}

def fetch_news(query: str) -> list[dict[str, Any]]:
    root = ET.fromstring(get(f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=tr&gl=TR&ceid=TR:tr").content); out = []
    for item in root.findall(".//item"):
        source = item.find("source"); published = item.findtext("pubDate") or ""
        try: when = parsedate_to_datetime(published).astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError): when = ""
        out.append({"title": (item.findtext("title") or "").strip(), "source": (source.text or "").strip() if source is not None else "Google News", "url": item.findtext("link") or "", "published": when})
    return out

def collect_narrative(now: datetime) -> dict[str, Any]:
    queries = ["Türkiye ekonomi when:7d", "Türkiye enflasyon döviz faiz when:7d", "Türkiye şirket iflas işsizlik when:7d"]
    with ThreadPoolExecutor(max_workers=3) as pool: batches = list(pool.map(fetch_news, queries))
    rows = list({x["url"]: x for batch in batches for x in batch if x.get("url")}.values()); total_weight = 0.0; evidence = []
    for row in rows:
        text = row["title"].lower(); hits = {term: value for term, value in DISTRESS.items() if term in text}; weight = sum(hits.values()); total_weight += weight
        if hits: evidence.append({**row, "terms": list(hits), "weight": round(weight, 1)})
    density = total_weight / max(1, len(rows)); score = round(clamp((density - .12) / .88 * 100), 1)
    return {"key": "narrative_strain", "score": score, "status": band(score), "weight": WEIGHTS["narrative_strain"], "available": True, "retained": False, "coverage": len(rows), "matched": len(evidence), "weighted_density": round(density, 3), "method": "Weighted stress-term density in three fixed seven-day Turkish economic RSS queries.", "evidence": sorted(evidence, key=lambda x: (x["weight"], x["published"]), reverse=True)[:12]}

def previous() -> dict[str, Any]:
    try: return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError): return {}
def fallback(old: dict[str, Any], key: str, now: datetime, error: Exception) -> dict[str, Any]:
    generated = pdt((old.get("meta") or {}).get("generated")); row = (old.get("components") or {}).get(key)
    if generated and timedelta(0) <= now - generated <= timedelta(hours=FALLBACK_HOURS) and isinstance(row, dict) and row.get("available"):
        copy = json.loads(json.dumps(row)); copy["retained"] = True; copy["retained_reason"] = type(error).__name__; return copy
    return {"key": key, "score": None, "status": "UNAVAILABLE", "weight": WEIGHTS[key], "available": False, "retained": False, "coverage": 0, "evidence": [], "error": type(error).__name__}

def main() -> None:
    now = datetime.now(timezone.utc); old = previous(); notes = []; components: dict[str, dict[str, Any]] = {}; fx = collect_fx_days(now.date())
    collectors = {
        "lira_dislocation": lambda: collect_lira(fx),
        "imported_energy": lambda: collect_energy(fx),
        "reserve_buffer": lambda: monthly_pressure(fred_series("TRESEGTRM052N", 1800), -1, "reserve_buffer", WEIGHTS["reserve_buffer"], "70% adverse monthly reserve-change anomaly + 30% three-month drawdown magnitude.", "Reserves excluding gold, USD mn", SOURCES[2]["url"]),
        "consumer_confidence": lambda: monthly_pressure(fred_series("CSCICP02TRM460S", 1800), -1, "consumer_confidence", WEIGHTS["consumer_confidence"], "70% adverse monthly confidence-change anomaly + 30% three-month deterioration.", "OECD consumer confidence", SOURCES[3]["url"]),
        "narrative_strain": lambda: collect_narrative(now),
    }
    for key, collector in collectors.items():
        try: components[key] = collector(); print(f"[live] {key}: {components[key]['score']}")
        except Exception as error:
            components[key] = fallback(old, key, now, error); notes.append(f"{key}: {'retained' if components[key].get('retained') else 'unavailable'} ({type(error).__name__})"); print(f"[fallback] {key}: {error}")
    available = [x for x in components.values() if x.get("available") and x.get("score") is not None]; denominator = sum(x["weight"] for x in available); raw = sum(x["score"] * x["weight"] for x in available) / denominator if denominator else 0
    market = any(num(components.get(k, {}).get("score")) >= 45 for k in ("lira_dislocation", "imported_energy")); macro = any(num(components.get(k, {}).get("score")) >= 45 for k in ("reserve_buffer", "consumer_confidence")); bonus = 5.0 if market and macro else 0.0; score = round(clamp(raw + bonus), 1); status = band(score); retained = sum(1 for x in available if x.get("retained")); confidence = "HIGH" if len(available) == 5 and not retained else "MEDIUM" if len(available) >= 4 else "LOW"; generated = now.isoformat()
    history = [x for x in old.get("history", []) if isinstance(x, dict) and x.get("generated")]; history.append({"generated": generated, "score": score, "status": status})
    output = {"meta": {"project": "tr-economic-sentiment", "generated": generated, "mode": "live" if len(available) == 5 and not retained else "partial", "version": "2.0.0", "horizon": "0–30 days", "classification": "economic-strain-screening-not-recession-currency-or-market-forecast", "coverage": f"{len(available)}/5", "confidence": confidence, "source_notes": notes}, "warning": {"score": score, "raw_score": round(raw, 1), "concurrence_bonus": bonus, "status": status, "headline": f"Türkiye economic-strain pressure is {status.lower()} at {score:.1f}/100.", "interpretation": "The index detects unusual, concurrent pressure across the lira, imported energy, reserves, household confidence and economic narrative. It is an early-warning screen, not a recession, currency or market forecast."}, "components": components, "history": history[-60:], "sources": SOURCES, "methodology": {"weights": WEIGHTS, "fallback_hours": FALLBACK_HOURS, "concurrence_rule": "+5 when a market channel and an independent macro channel are both at least 45"}}
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8"); print(f"score={score} status={status} coverage={len(available)}/5 confidence={confidence}")

if __name__ == "__main__": main()
