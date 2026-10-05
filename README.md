# x-niche-bot

A reusable, configuration-driven bot for X (Twitter). Eventually it will discover posts in a niche, score them for relevance, draft replies, publish original posts and track everything in PostgreSQL. You switch niches by changing a config file, not code.

It uses **only the official X API**. It has no browser automation, scraping, or cookie/session access.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: config, schema, logging, tooling | Done |
| 2 | X API client, discovery, filtering, relevance scoring, persistence | Done |
| 3 | AI replies, validation, dedup, rate limits, review queue | Done |
| 4 | Original post generation and publishing | Done |
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
  ai/                 AI provider interface + Anthropic implementation
  content/            Shared voice prompt and generated-text validation
  engagement/         Reply prompt, engagement engine, review commands
  publishing/         Post prompt, publishing engine, post review commands
  scheduler/          Job scheduling / worker                         (later)
  database/           Prisma client factory + repositories/
  services/           Job-level orchestration (discovery, engagement, publishing, run tracking)
  cli/                Run-once job CLI and review CLI
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
| `AI_PROVIDER` | no | `none` | `none` \| `anthropic`. |
| `AI_API_KEY` | when provider ≠ `none` | — | AI provider API key. |
| `AI_MODEL` | when provider ≠ `none` | — | Model ID, e.g. `claude-opus-5-5`. |
| `AI_EFFORT` | no | model default | `low` \| `medium` \| `high` \| `xhigh` \| `max`. |

**Why only four X credentials:** OAuth 1.0a user context covers both recent search and creating posts/replies as the bot account. You don't need `X_BEARER_TOKEN` (app-only, read-only) or `X_CLIENT_ID`/`X_CLIENT_SECRET` (OAuth 2.0 PKCE). Add them later only if we switch auth methods.

The env rate limits are global caps. The niche config's optional `engagement.maxRepliesPerHour` can be stricter, and the lower value wins. Dry-run and live replies are counted separately.

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
  "engagement": { "enabled": false, "mode": "review", "delivery": "intent" },
  "publishing": { "enabled": false, "mode": "auto", "postsPerDay": 3, "topics": ["lending risk", "oracles"] }
}
```

- `niche.name` is a slug that tags every database row, so several niches can share one database.
- `engagement.mode` defaults to `review` and `engagement.delivery` to `intent`. See [Replies](#replies) for why.
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

## Replies

**X API restriction.** Since 23 February 2026, X rejects replies posted through the API on the Free, Basic, Pro and Pay-Per-Use tiers, unless the original author @mentioned your account or quoted one of your posts. Enterprise is unaffected. So the bot drafts replies, and by default you post them yourself.

The engagement pipeline: **eligible post → per-author limit → AI draft → validation (one retry with feedback) → review queue → delivery**.

- **Drafting:** the prompt includes the niche voice (`voice.persona`, `tone`, `guidelines`), the post (marked as untrusted data), why it matched, and your recent replies so wording isn't repeated. The model can answer `SKIP` when there's nothing useful to add (sensitive topics, bait, missing facts).
- **Validation:** checks X weighted length, links, hashtags, @mentions, banned phrases (built-in generic openers like "great point" plus `voice.bannedPhrases`), excluded keywords, exact duplicates (content hash) and near-duplicates (`similarityThreshold`) against the last 50 replies.
- **Never twice:** every drafted, skipped or failed attempt is stored, and a database unique constraint stops a second reply to the same post.
- **Limits:** `maxDraftsPerRun`, `maxPendingReviews` and `maxRepliesPerAuthorPerDay` in the niche config. For API delivery, the hourly and daily caps also apply.

| `delivery` | How replies get posted |
| --- | --- |
| `intent` (default) | `npm run review -- approve <id>` prints an X web-intent link. It opens X's own composer with the reply filled in, and you click Post. Then run `npm run review -- done <id>`. |
| `api` | Approved replies are posted by the next engagement run. Only works with Enterprise access, or for posts that mention or quote you. A 403 is recorded as `FAILED` with an explanation. |

`mode: "auto"` skips human review and requires `delivery: "api"`.

### Review commands

```bash
npm run review -- list                     # drafts waiting for review
npm run review -- approve <id>             # approve as written
npm run review -- approve <id> new text    # approve with your own edit
npm run review -- reject <id>
npm run review -- links                    # approved replies with intent links
npm run review -- done <id> [reply url]    # mark as posted
```

## Publishing

Posting your own content through the API is still allowed, so publishing defaults to `mode: "auto"`. `DRY_RUN=true` still blocks real posting. In a dry run, posts are generated and stored without X credentials.

Each publishing run posts **at most one** post, and only when all of these hold:
- fewer than `min(postsPerDay, MAX_POSTS_PER_DAY)` posts in the last 24 hours
- at least `minMinutesBetweenPosts` since the last post
- the current hour is inside `activeHours` (optional, timezone-aware, can wrap past midnight)

How a post is written:
- **Topic:** the least recently used entry in `publishing.topics`, so topics rotate.
- **Context:** with `useDiscoveredContext`, the 5 highest-scoring posts discovered in the last 24 hours go into the prompt so the post is timely. They're marked as context only, and validation rejects anything too similar to them, so the bot can't copy them.
- **Validation:** the same checks as replies (length, links, hashtags, banned phrases, duplicates), compared against the bot's last 50 posts.

With `mode: "review"`, drafts queue up (at most 3 at a time) and you approve them with `npm run review -- posts list | approve <id> [edit] | reject <id>`. The next publishing run posts approved drafts.

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
| `npm run job -- <name>` | Run one job once (`discovery`, `engagement`, `publishing`). |
| `npm run review -- <command>` | Review drafted replies (see [Review commands](#review-commands)). |
