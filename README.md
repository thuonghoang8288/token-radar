# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/thuonghoang8288/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/thuonghoang8288/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar. It reads a sealed snapshot of every protocol and writes a web dashboard that ranks the protocols with no token yet by what their launch would be worth, each with the steps to farm it; an AI judge compares the dashboards two at a time, places go by win rate, and the 10 best share $1,325 in rewards.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

## How it works

The program reads the sealed snapshot (758 protocols, as of 2026-11-14), keeps every
protocol that could plausibly launch a token — pre-token by DefiLlama's record, not a
wrapped, staked or bridged product, not an exchange, not a versioned pool — and ranks
all 198 of them (the 40 watchlist slugs plus 158 below the floor) by implied launch
value. The value model is calibrated from the snapshot's own trading protocols: each
category's median market-cap/TVL, shrunk toward the global median of 0.2049, times a
growth factor (7-day TVL change, clamped), a maturity factor (time running with no
token) and a chain-breadth factor. Live-token protocols are kept apart and shown with
their market caps, never mixed into the ranking. Every row carries a six-step farm
plan from an archetype template (lending, DEX, yield, curator, RWA, …) with the
protocol's own name, chain, capital tier and hold window filled in.

The dashboard (dashboard/) renders the board with search, category and chain filters,
a watchlist toggle, sortable columns and a detail view per protocol — model breakdown
with every factor's number, the farm plan, and the calibration table — plus a live-token
view and a model panel. It is a static page: no framework, no network, the dataset
arrives as data.js beside it.

---

<sub>Entered on [make.fun](https://make.fun/?ref=namj8s1b&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
