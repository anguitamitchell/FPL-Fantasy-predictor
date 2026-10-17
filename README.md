# FPL Predictor

Expected points, differentials and transfer planning for Fantasy Premier League, built on the official FPL API.

- **Dashboard**: captain picks with haul chance and ceiling, the best players by position over the next 5 GWs, best value, and likely price rises and falls tonight.
- **Players**: every player's projected points per gameweek, filterable and sortable. Click a row to see where the points come from (minutes, goals, assists, clean sheets, defensive contributions, bonus…).
- **Differentials**: low-owned players ranked by *edge* (xPts × share of managers who don't own them). Each one is tagged with why it looks undervalued: underlying stats ahead of returns, model rank ≫ ownership rank, ownership rising, a kind run of fixtures, or minutes going up. Also lists popular players projected to underperform.
- **Fixtures**: a fixture ticker coloured by expected goal difference from our own team ratings, not FPL's 1–5 difficulty.
- **My Team**: import your squad by FPL ID (real selling prices, free transfers, chips) or build one by hand, then run the optimiser. It solves a mixed-integer program (HiGHS) for hold / 1 / 2 / 3 transfers / solver's choice / Wildcard / Free Hit. Plans respect budget, the 2-5-5-3 squad, max 3 per club and valid formations, and come with a starting XI, captain and bench order.

Form from **other competitions** (UCL, UEL, UECL, FA Cup, EFL Cup) is included. Midweek fixtures lower a player's chance of starting, and non-PL attacking output nudges attacking projections (capped at ±10%).

## How the projections work

Each player is projected **per fixture**, so double and blank gameweeks fall out naturally:

| Part | How it's estimated |
| --- | --- |
| Team strength | Attack/defence ratings fitted to recent xG (70%) and goals (30%), with home advantage, shrunk toward FPL's pre-season strength |
| Minutes | Recency-weighted start rate, minutes per start/sub, P(60+), plus FPL status/news (e.g. "Expected back 25 Oct") and fixture congestion |
| Goals / assists | Recency-weighted xG/xA per 90, blended with last season and a price-aware position prior, scaled by opponent and venue |
| Clean sheets / goals conceded | Poisson on the opponent's expected goals |
| Defensive contributions | Negative binomial on CBIT/CBIRT per 90 (dispersion calibrated on real data) vs the 10/12 thresholds |
| Saves, bonus, cards | Per-90 rates scaled by fixture |

Scoring values are read from FPL's own `game_config`, so rule changes are picked up automatically.

**Backtest** (walk-forward, no future data): over 2025/26 GW3–38 the model's mean absolute error is **1.60** vs **1.74** for a 4-GW form baseline, and its top-50 picks average **4.27** points per GW vs **3.55**. On this season's GW2–6 it beats form on MAE and rank correlation in every week. A ridge calibration and a small gradient-boosted model were also trained on 2025/26. Neither improved this season's out-of-sample picks, so the transparent model stays. See `scripts/backtest-past.ts`, `scripts/fit-calibration.ts` and `scripts/fit-gbm.ts`.

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Local data is cached under `.data/` (git-ignored). To fill it:

```bash
curl http://localhost:3000/api/cron/ingest
```

This takes a price/ownership snapshot, stores settled gameweeks, loads last-season priors and pulls other-competition data.

```bash
npm test             # vitest: schemas, model maths, optimiser constraints, ESPN parsing
npx tsx scripts/report.ts             # top projections vs FPL's ep_next
npx tsx scripts/backtest.ts           # this season, walk-forward
npx tsx scripts/backtest-past.ts      # 2025/26 (needs vaastav CSVs in .data/, see the script)
```

## Deploying (Vercel + Supabase)

1. Create a Supabase project and run `supabase/migrations/0001_kv.sql`.
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` in Vercel (`vercel env add …`).
3. `vercel deploy --prod`. `vercel.json` schedules `/api/cron/ingest` daily at 06:00 UTC.

Without Supabase, the app still runs, but anything stored (snapshots, priors, cup data) only lives in the function's `/tmp`.

## Data sources

- Official FPL API (`bootstrap-static`, `fixtures`, `event/{gw}/live`, `element-summary`, public `entry/{id}/…` endpoints). Proxied and cached server side, so there are no CORS proxies.
- ESPN's public soccer API for cup and European schedules and box scores (unofficial; the app works without it).
- [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League) for past-season backtests only.

The original single-file version lives in `legacy/index.html`.

## Disclaimer

Not affiliated with or endorsed by the Premier League or Fantasy Premier League. Projections are estimates for entertainment, not advice.

GNU GPL v3. See `LICENSE`.
