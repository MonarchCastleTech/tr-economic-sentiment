# -*- coding: utf-8 -*-
"""Turkiye Economic Sentiment Radar - Live Data Pipeline"""
import os
import json
import yaml
from datetime import datetime, timezone
from openrouter_llm import analyze_with_llm
from data_fetcher import fetch_coingecko, fetch_earthquakes, fetch_exchange_rates, fetch_google_news_rss, safe_fetch

def load_config():
    with open(os.path.join(os.path.dirname(__file__), "config.yaml"), "r") as f:
        return yaml.safe_load(f)

def extract_live_data(config):
    """Pull real data from configured sources."""
    results = {}
    print("[LIVE] Fetching real data...")

    # --- Google News RSS (all projects) ---
    news_query = config.get("news_query", "geopolitical risk")
    articles = safe_fetch(fetch_google_news_rss, news_query, 50)
    if articles:
        results["news_articles"] = articles[:50]
        print(f"  Google News RSS: {len(articles)} articles")
    else:
        results["news_articles"] = []

    econ_news = safe_fetch(fetch_google_news_rss, "economy inflation Turkey", 50)
    if econ_news:
        results["economic_news"] = econ_news

    btc = safe_fetch(fetch_coingecko, "bitcoin")
    if btc:
        results["crypto"] = {"btc_price_usd": btc.get("market_data", {}).get("current_price", {}).get("usd", 0)}

    # --- Exchange Rates (if configured) ---
    if config.get("include_forex"):
        rates = safe_fetch(fetch_exchange_rates, "USD")
        if rates:
            results["exchange_rates"] = rates[:20] if isinstance(rates, list) else rates
            print(f"  Forex: {len(results['exchange_rates'])} rates")

    return results

def transform_data(raw, config):
    """Transform raw fetches into scored entities."""
    return raw


def main():
    config = load_config()
    print(f"=== TES Pipeline ===")

    previous = {}
    if os.path.exists("data/output.json"):
        try:
            with open("data/output.json", "r", encoding="utf-8") as existing:
                previous = json.load(existing)
        except (OSError, json.JSONDecodeError):
            previous = {}

    # Live data extraction
    live_data = extract_live_data(config)
    retained_news = False
    if not live_data.get("news_articles"):
        previous_articles = previous.get("live_data", {}).get("news_articles", [])
        if previous_articles:
            live_data["news_articles"] = previous_articles
            retained_news = True
            print(f"  Google News RSS: retained {len(previous_articles)} previously validated articles")

    # Build output structure
    output = {
        "meta": {
            "project": "tr-economic-sentiment",
            "generated": datetime.now(timezone.utc).isoformat(),
            "mode": "partial" if retained_news else ("live" if live_data else "unavailable"),
            "sources": [name for name, value in live_data.items() if value],
            "source_notes": (["Google News RSS unavailable; retained last validated news snapshot."] if retained_news else []),
            "news_snapshot_at": previous.get("meta", {}).get("news_snapshot_at", previous.get("meta", {}).get("generated")) if retained_news else datetime.now(timezone.utc).isoformat(),
            "version": "1.0.0"
        },
        "stats": [
            {"label": "Articles tracked", "value": str(len(live_data.get("news_articles", []))), "delta": "observed"},
            {"label": "News domains", "value": str(len({a.get("domain") for a in live_data.get("news_articles", []) if a.get("domain")})), "delta": "deduplicated"},
            {"label": "Feeds connected", "value": str(len(live_data)), "delta": "current run"},
            {"label": "Forecast accuracy", "value": "not evaluated", "delta": "no benchmark published"},
        ],
        "live_data": live_data,
        "entities": [],
        "events": live_data.get("news_articles", [])[:15],
        "timeseries": [],
        "llm_summary": "No optional language-model summary configured."
    }

    # Generate entities from live data
    if live_data.get("news_articles"):
        for i, a in enumerate(live_data["news_articles"][:10]):
            tone = float(a.get("tone", 0))
            score = min(10, max(1, 5 + abs(tone)))
            output["entities"].append({
                "id": i + 1,
                "name": a.get("title", "")[:60],
                "score": round(score, 1),
                "category": "news",
                "last_seen": a.get("seendate", ""),
                "source": a.get("domain", "")
            })

    # LLM analysis
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if api_key and live_data:
        print("[LLM] Analyzing with OpenRouter...")
        output["llm_summary"] = analyze_with_llm(
            output, config["openrouter"]["model"], api_key
        )

    # Write output
    os.makedirs("data", exist_ok=True)
    with open("data/output.json", "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Done. Output: data/output.json ({len(json.dumps(output))} bytes)")
    print(f"Mode: {'LIVE' if live_data else 'UNAVAILABLE'}")

if __name__ == "__main__":
    main()
