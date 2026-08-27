# Türkiye Economic Sentiment Radar

[![Pages](https://github.com/MonarchCastleTech/tr-economic-sentiment/actions/workflows/pipeline.yml/badge.svg)](https://github.com/MonarchCastleTech/tr-economic-sentiment/actions/workflows/pipeline.yml)

Deterministic 0–30 day economic-strain early warning for Türkiye.

**Live dashboard:** https://monarchcastletech.github.io/tr-economic-sentiment/

## Run locally

```bash
python -m pip install -r requirements.txt
python pipeline/tr_economic_sentiment_pipeline.py
python -m unittest discover -s tests -v
python -m http.server 8000
```

Open `http://localhost:8000`. Direct `file://` access cannot fetch `data/output.json` in modern browsers.

## Automation

GitHub Actions refreshes five public-data channels every six hours, tests the deterministic model, commits the machine-readable snapshot, and deploys GitHub Pages. No account, API key, paid feed, or language model is required.

## Method

Weighted channels: TCMB lira dislocation (30%), TRY-priced Brent pressure (25%), IMF reserve-buffer pressure (20%), OECD consumer-confidence deterioration (15%), and fixed-query narrative strain (10%). Full equations, missing-data policy, warning bands, and reproduction instructions are on the [methodology page](https://monarchcastletech.github.io/tr-economic-sentiment/methodology/).

## Data notice

Source availability varies. The dashboard identifies its generation time and operating mode in `data/output.json`. Treat indicators as decision-support signals, not verified ground truth.

## Brand

Part of Monarch Castle Technologies. See [BRAND.md](BRAND.md) for approved asset use.
