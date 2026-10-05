# x-niche-bot

A reusable, configuration-driven bot for X (Twitter). Eventually it will discover posts in a niche, score them for relevance, draft replies, publish original posts and track everything in PostgreSQL. You switch niches by changing a config file, not code.

It uses **only the official X API**. It has no browser automation, scraping, or cookie/session access.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: config, schema, logging, tooling | Done |
| 2 | X API client, discovery, filtering, relevance scoring, persistence | Done |
| 3 | AI replies, validation, dedup, rate limits, review queue | Planned |
| 4 | Original post generation and publishing | Planned |
| 5 | Scheduler/worker | Planned |

## Tech stack

Node.js ≥ 20.19 · TypeScript · PostgreSQL · Prisma 7 (with `@prisma/adapter-pg`) · Zod 4 · Pino · Vitest · tsx (dev runner)

## Project structure

```
config/niches/        Niche config files (JSON). example.json is a placeholder.
prisma/schema.prisma  Database schema
prisma.config.ts      Prisma CLI config (schema path, migrations, DATABASE_URL)
src/
  config/             Env + niche config schemas and loaders
  x/                  X API v2 client (OAuth 1.0a), dry-run wrapper, response mapping
  discovery/          Query building, filters, relevance scoring, discovery engine
  engagement/         Reply generation, validation, review queue      (Phase 3)
  publishing/         Original post generation and publishing         (Phase 4)
  scheduler/          Job scheduling / worker                         (later)
  database/           Prisma client factory + repositories/
  services/           Job-level orchestration (discovery, run tracking)
  cli/                Run-once job CLI
  app.ts              Builds env, logger, DB, X client and repositories
  utils/              Logger and shared helpers
  types/              Platform-agnostic domain types
  generated/          Generated Prisma client (gitignored)
  index.ts            Entry point
tests/                Vitest tests
```

## Environment variables

Copy `.env.example` to `.env`. Blank values fall back to defaults. Validation errors name the variable but never print its value.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production`. Development uses pretty logs. |
| `LOG_LEVEL` | no | `info` | Pino log level. |
| `X_API_KEY` | when `DRY_RUN=false` | — | X app consumer key (OAuth 1.0a). |
| `X_API_SECRET` | when `DRY_RUN=false` | — | X app consumer secret. |
| `X_ACCESS_TOKEN` | when `DRY_RUN=false` | — | Bot account's user access token. |
| `X_ACCESS_TOKEN_SECRET` | when `DRY_RUN=false` | — | Bot account's user access token secret. |
| `DATABASE_URL` | **yes** | — | `postgresql://` connection string. |
| `BOT_NAME` | **yes** | — | Name used in logs. |
| `BOT_ENABLED` | no | `true` | If `false`, the bot exits without running. |
| `DRY_RUN` | no | `true` | If `true`, nothing is ever posted to X. |
| `NICHE_CONFIG_PATH` | no | `config/niches/example.json` | Niche config file to load. |
| `SEARCH_LANGUAGE` | no | `en` | Default search language. |
| `SEARCH_MAX_RESULTS` | no | `25` | Results per search request (10–100). |
| `SEARCH_LOOKBACK_MINUTES` | no | `60` | How far back to search on a run. |
| `MAX_REPLIES_PER_HOUR` | no | `5` | Global hourly reply cap (must be ≤ daily cap). |
| `MAX_REPLIES_PER_DAY` | no | `30` | Global daily reply cap. |
| `MAX_POSTS_PER_DAY` | no | `3` | Global daily original-post cap. |
| `DISCOVERY_INTERVAL_MINUTES` | no | `15` | How often discovery runs. |
| `PUBLISH_INTERVAL_MINUTES` | no | `240` | How often publishing runs. |
| `AI_PROVIDER` | no | `none` | `none` \| `anthropic` \| `openai`. |
| `AI_API_KEY` | when provider ≠ `none` | — | AI provider API key. |
| `AI_MODEL` | when provider ≠ `none` | — | Model ID for the provider. |

**Why only four X credentials:** OAuth 1.0a user context covers both recent search and creating posts/replies as the bot account. You don't need `X_BEARER_TOKEN` (app-only, read-only) or `X_CLIENT_ID`/`X_CLIENT_SECRET` (OAuth 2.0 PKCE). Add them later only if we switch auth methods.

The env rate limits are global caps. The niche config's `engagement.maxRepliesPerHour` can be stricter, and the lower value wins.

## Niche configuration

Each niche is a JSON file validated by `src/config/niche.schema.ts`:

```json
{
  "niche": {
    "name": "web3-defi",
    "searchQueries": ["defi", "\"decentralized finance\"", "#DeFi"],
    "excludedKeywords": ["giveaway", "airdrop"],
    "languages": ["en"],
    "minimumRelevanceScore": 0.5
  },
  "targeting": { "includeAuthors": [], "excludeAuthors": [] },
  "engagement": { "enabled": false, "mode": "review", "maxRepliesPerHour": 0 },
  "publishing": { "enabled": false, "postsPerDay": 0 }
}
```

- `niche.name` is a slug that tags every database row, so several niches can share one database.
- `engagement.mode` defaults to `review`: generated replies wait for human approval. X's automation rules restrict automated replies to posts found only through keyword search, so use `auto` only where the rules allow it.
- Everything except `niche.name` has a safe default. See `config/niches/example.json` for every option, including `search`, `filters` and `scoring`.

To switch niches, create `config/niches/<your-niche>.json` and set `NICHE_CONFIG_PATH`.

## Discovery and relevance

Each discovery run does the following:
1. Wraps every `searchQueries` entry with language and post-type operators. For example, `defi` becomes `(defi) lang:en -is:retweet -is:reply`.
2. Uses the newest post ID from the previous run (`since_id`) so only new posts are fetched. On the first run it uses `SEARCH_LOOKBACK_MINUTES`.
3. Removes posts already found by another query, then checks each post against the hard filters and the relevance score.
4. Stores every post with its score breakdown, matched terms and filter reasons, so you can tune the config from real data.

**Hard filters** (failing any one makes the post ineligible): own post, repost, reply, excluded author, language, excluded keyword, too new or too old, too short, too many hashtags or mentions, below the minimum engagement.

**Relevance score** (0–1): a weighted average of five components. Weights are set in `scoring.weights`.

| Component | Value |
| --- | --- |
| keyword | matched keywords ÷ `keywordSaturation`, capped at 1 |
| hashtag | 1 if any configured hashtag is present |
| author | 1 if the author is in `includeAuthors`. Ignored when that list is empty. |
| engagement | log-scaled (likes + 2×replies + 3×reposts/quotes), full at `engagementTarget` |
| recency | 1 at `minPostAgeMinutes`, falling linearly to 0 at `maxPostAgeMinutes` |

A post is **eligible** when it passes every filter and scores at least `minimumRelevanceScore`. If you leave `keywords`/`hashtags` empty, they're taken from `searchQueries`.

Run one discovery pass by hand: `npm run job -- discovery`. It needs the X credentials, even in dry-run mode, because search is a real API call.

## Local setup

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL and BOT_NAME
npm run db:generate         # generate the Prisma client
npm run typecheck
npm test
npm run dev
```

## Database setup

You need a running PostgreSQL instance. For example, with Docker:

```bash
docker run -d --name x-niche-bot-db -p 5432:5432 \
  -e POSTGRES_USER=bot -e POSTGRES_PASSWORD=bot -e POSTGRES_DB=x_niche_bot postgres:17
# DATABASE_URL=postgresql://bot:bot@localhost:5432/x_niche_bot?schema=public

npm run db:migrate          # applies migrations in prisma/migrations
npm run db:studio           # browse data
```

Key constraints:
- `DiscoveredPost`: unique on `(platform, externalId, niche)`.
- `Engagement`: unique on `(platform, targetExternalId, type)`, so a post can never be replied to twice.
- Both `Engagement` and `PublishedPost` store a `contentHash`, used later for duplicate-content checks.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run from source with watch mode (tsx). |
| `npm run build` | Compile to `dist/`. |
| `npm run start` | Run the compiled build. |
| `npm test` | Run tests once. |
| `npm run test:watch` | Run tests in watch mode. |
| `npm run typecheck` | Type-check src and tests. |
| `npm run db:migrate` | Create/apply migrations (dev). |
| `npm run db:generate` | Generate the Prisma client. |
| `npm run db:studio` | Open Prisma Studio. |
| `npm run job -- <name>` | Run one job once (`discovery`). |
