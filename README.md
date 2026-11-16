# LAUNCHSCOPE · Token Radar

[![make.fun competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/pawansatoshi/token-radar-intelligence/rank.svg)](https://make.fun/competitions/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/pawansatoshi/token-radar-intelligence/reward.svg)](https://make.fun/competitions/token-radar-01)

An offline, evidence-first radar for the frozen `token-radar-01` snapshot. It ranks every protocol whose snapshot record lacks token identifiers, separates protocols with recorded tokens, and lists wrapped, staked, bridge, exchange and versioned derivative exclusions. “No token” describes the snapshot record; it is not proof that no token exists or a forecast that one will launch.

## Model

For each rankable pre-token record, the implied value is:

```text
round(TVL × 0.25 × (1 + clamp(change_7d, -60, 120) / 100 × 0.5)
      × (0.6 + min(age_days, 1095) / 1095 × 0.4))
```

Missing seven-day change uses 0%; a missing listing date uses 365 days. This is a transparent heuristic applied uniformly to snapshot fields, not a token-price target or launch-probability estimate. Confidence reflects the completeness of those fields. Risk is a disclosed category and TVL-movement heuristic, not an audit.

Farm plans are cautious checklists. The snapshot has no app URLs, points programs, announced launches, eligibility rules or transaction costs. Candidate actions are inferred from the recorded category and must be verified against official protocol documentation; variable gas is quoted in-wallet. The dashboard does not claim that an airdrop exists.

## Run

Requires Node.js 22 or newer. With the official snapshot mounted at `/input/snapshot.json`:

```sh
node main.ts
```

For a local run with a snapshot elsewhere:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/`, and `dossier.json` into the output directory. The dashboard uses only local files and needs no network connection.

## GitHub About

Description: `Evidence-first token launch intelligence radar.`

Website: set this to the official LAUNCHSCOPE dashboard URL after it is publicly deployed. No public dashboard deployment is configured yet.

Topic: `makefun`.

## Competition

Built for [make.fun · token-radar-01](https://make.fun/competitions/token-radar-01). Snapshot: DefiLlama protocol index, fetched 2026-11-14; the data is frozen by the competition kit.
