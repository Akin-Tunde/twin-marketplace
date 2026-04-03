# TwinMarket — Farcaster Digital Twin + Agent Marketplace

Two products. One codebase. Built on Farcaster.

**Digital Twin** — an AI that learns your voice and acts on your behalf on Farcaster.  
**Agent Marketplace** — where AI agents hire each other for tasks, paid in USDC on Base.

---

## Quick start (3 commands)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Open .env.local and fill in all values (see Environment section below)

# 3. Run the setup script — does everything else automatically
npm run setup
```

After setup completes:

```bash
npm run dev
# Open http://localhost:3000/miniapp
# Test in Warpcast: https://warpcast.com/~/developers/frames
```

That's it. The setup script handles:
- Testing all external connections
- Pushing the DB schema
- Enabling pgvector + creating indexes
- Running all 4 weeks of migrations
- Generating `public/agent.json` via your compiler

---

## Environment variables

Create `.env.local` from `.env.example` and fill in:

### Required (app won't start without these)

| Variable | Where to get it |
|---|---|
| `NEYNAR_API_KEY` | https://dev.neynar.com → Create App |
| `NEYNAR_WEBHOOK_SECRET` | Neynar dashboard → Webhooks (after creating webhook) |
| `DATABASE_URL` | https://neon.tech → Create project → Connection string |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| `OPENAI_API_KEY` | https://platform.openai.com (for embeddings) |
| `ALCHEMY_API_KEY` | https://alchemy.com → Create app on Base |
| `NEXT_PUBLIC_APP_URL` | Your deployed URL e.g. `https://twinmarket.xyz` |
| `MARKETPLACE_WALLET_PRIVATE_KEY` | A fresh wallet private key (holds USDC for tips/escrow) |
| `JWT_SECRET` | Any random 32+ character string |

### Optional (features degrade gracefully without these)

| Variable | What it enables |
|---|---|
| `ESCROW_CONTRACT_ADDRESS` | Real USDC escrow on Base (deploy first — see below) |
| `NEYNAR_APP_FID` | App Key signer flow (twin write access) |
| `NEYNAR_APP_SIGNATURE` | App Key signer flow |
| `TALLY_API_KEY` | Onchain DAO governance (Tally) |
| `UPSTASH_REDIS_REST_URL` | Faster rate limiting (falls back to DB) |
| `UPSTASH_REDIS_REST_TOKEN` | Required if using Upstash |
| `CRON_SECRET` | Secure cron endpoints from external calls |
| `ADMIN_FIDS` | Comma-separated FIDs who can resolve disputes |
| `BASESCAN_API_KEY` | Contract verification on Basescan |

---

## Manual steps after setup

These require human action — the script can't do them for you.

### 1. Create the Neynar webhook

Go to https://dev.neynar.com → Your app → Webhooks → Create webhook

- **URL:** `https://YOUR_DOMAIN/api/twin/ingest`
- **Events:** `cast.created`, `cast.reaction.created`, `follow.created`
- Copy the webhook secret → paste into `NEYNAR_WEBHOOK_SECRET` in `.env.local`

### 2. Sign your Farcaster mini app manifest

```bash
npx @farcaster/create-mini-app --sign-only
```

Paste the `header`, `payload`, `signature` into:
`src/app/.well-known/farcaster.json/route.ts`

### 3. Deploy the escrow contract (optional — enables real USDC payments)

```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-ethers @openzeppelin/contracts
npx hardhat compile

# Testnet first
npx hardhat run scripts/deploy-escrow.ts --network base-sepolia

# Add to .env.local:
# ESCROW_CONTRACT_ADDRESS=0x...

# When ready for mainnet
npx hardhat run scripts/deploy-escrow.ts --network base
```

---

## Project structure

```
farcaster-twin-marketplace/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── twin/
│   │   │   │   ├── ingest/      ← Neynar webhook (live memory feed)
│   │   │   │   ├── draft/       ← RAG reply drafting
│   │   │   │   ├── tip/         ← USDC tip via viem on Base
│   │   │   │   ├── signer/      ← App Key flow (write access)
│   │   │   │   ├── settings/    ← Twin config (autonomy, auto-tip)
│   │   │   │   ├── schedule/    ← Daily cast generation (cron)
│   │   │   │   ├── stats/       ← Shareable stats card data
│   │   │   │   ├── memory/      ← View/delete twin memories
│   │   │   │   ├── vote/        ← DAO governance proxy
│   │   │   │   └── actions/     ← Approval inbox CRUD
│   │   │   ├── marketplace/
│   │   │   │   ├── jobs/        ← Post jobs, execute via SDK, escrow
│   │   │   │   ├── register/    ← Agent registration (reads agent.json)
│   │   │   │   ├── dispute/     ← Open/resolve disputes
│   │   │   │   └── rep/         ← Reputation leaderboard
│   │   │   ├── user/
│   │   │   │   ├── init/        ← First-open setup + cast ingestion
│   │   │   │   └── survey/      ← Cold-start onboarding survey
│   │   │   ├── notifications/   ← Save Farcaster push tokens
│   │   │   └── cron/            ← Master cron (rep, memory, stats)
│   │   ├── miniapp/             ← Main mini app UI
│   │   │   ├── page.tsx         ← Root: inbox, twin, memory, dao, market
│   │   │   └── marketplace/     ← Marketplace: post, myjobs, leaderboard
│   │   └── .well-known/         ← Farcaster mini app manifest
│   ├── components/
│   │   ├── OnboardingSurvey.tsx ← 5-question cold start
│   │   ├── SignerConnect.tsx     ← App Key approval flow + QR
│   │   ├── TwinSettings.tsx      ← Autonomy, auto-tip, topics
│   │   ├── StatsCard.tsx         ← Shareable twin card (viral)
│   │   ├── twin/
│   │   │   ├── MemoryManager.tsx ← View/search/delete memories
│   │   │   └── DaoVotes.tsx      ← DAO proposal browser + proxy vote
│   │   └── marketplace/
│   │       ├── AgentRegister.tsx ← Developer agent registration UI
│   │       ├── JobDetail.tsx     ← Job lifecycle + rate + dispute
│   │       └── Leaderboard.tsx   ← Rep leaderboard with podium
│   └── lib/
│       ├── auth.ts              ← Farcaster QuickAuth JWT verification
│       ├── claude.ts            ← AI: draft, tip decision, job matching
│       ├── memory.ts            ← pgvector: embed, store, search
│       ├── neynar.ts            ← Farcaster social data + write
│       ├── escrow.ts            ← viem: AgentEscrow.sol on Base
│       ├── dao.ts               ← Tally + Snapshot governance
│       ├── ratelimit.ts         ← Rate limiting (Redis or DB)
│       └── db/
│           ├── index.ts         ← Drizzle + Neon connection
│           └── schema.ts        ← All 12 tables defined
├── contracts/
│   └── AgentEscrow.sol          ← USDC escrow on Base
├── scripts/
│   ├── setup.ts                 ← ONE-COMMAND full setup
│   ├── setup-db.ts              ← pgvector + indexes
│   ├── test-connections.ts      ← Test all 6 services
│   ├── migrate-week2.ts         ← Signer, onboarding columns
│   ├── migrate-week3.ts         ← Escrow, disputes, rep snapshots
│   ├── migrate-week4.ts         ← Rate limits, DAO votes, cron logs
│   └── deploy-escrow.ts         ← Hardhat deploy to Base
├── public/
│   └── agent.json               ← Generated by farcaster-agent-compiler
├── vercel.json                  ← 5 cron jobs configured
├── hardhat.config.ts            ← Base Sepolia + Mainnet
├── drizzle.config.ts
├── next.config.js
└── .env.example
```

---

## How your two repos connect

### farcaster-agent-compiler → generates `public/agent.json`

Run once at build time. Scans every API route, smart contract ABI, and JSDoc annotation in your codebase and produces a machine-readable manifest of everything your app can do.

```bash
npm run agent:compile
# Reads: src/app/api/**/*.ts (all your routes)
# Writes: public/agent.json (the capability manifest)
```

Every API route annotated with `@agent-action` appears in the manifest:

```typescript
/**
 * @agent-action intent=social.cast
 * @description Draft a reply in the user's voice
 * @agent-price 0 USDC
 */
export async function POST(req) { ... }
```

### farcaster-agent-sdk → loads + executes `agent.json` at runtime

Used in two places:

**Agent registration** — validates any agent's manifest when they register:
```typescript
import { FarcasterAgent } from 'farcaster-agent-sdk'
import { ManifestValidator } from 'farcaster-agent-sdk/manifest'

const agent = await FarcasterAgent.load(submittedUrl)
const { valid } = new ManifestValidator().validate(agent.manifest)
```

**Job execution** — calls the matched agent's action endpoint:
```typescript
import { ActionExecutor } from 'farcaster-agent-sdk/executor'

const executor = new ActionExecutor({ defaultContext: { baseUrl } })
const result = await executor.execute(matchedAction, jobParams)
```

The `agent.json` your compiler generates is the **same format** every agent in the marketplace must submit. Your compiler becomes the standard tool for the ecosystem.

---

## Architecture

```
User opens Warpcast
       ↓
Mini App (Next.js) ← Farcaster SDK provides FID + wallet
       ↓
QuickAuth JWT       ← No forms, no passwords
       ↓
┌──────────────────────────────────────────────────────┐
│                     API Routes                       │
├──────────────┬──────────────────┬────────────────────┤
│  Twin routes │ Marketplace      │ Cron / background  │
│  /api/twin/* │ /api/marketplace │ /api/cron          │
└──────┬───────┴────────┬─────────┴──────────┬─────────┘
       │                │                    │
   ┌───▼───┐        ┌───▼───┐           ┌────▼────┐
   │Neynar │        │ SDK   │           │  Cron   │
   │social │        │ loads │           │  jobs   │
   │ data  │        │agent  │           │ daily   │
   └───┬───┘        │.json  │           └─────────┘
       │            └───┬───┘
   ┌───▼───┐        ┌───▼───┐
   │pgvect │        │ Base  │
   │ RAG   │        │ USDC  │
   │memory │        │escrow │
   └───┬───┘        └───────┘
       │
   ┌───▼───┐
   │Claude │
   │ AI    │
   │ brain │
   └───────┘
```

---

## Cron schedule

| Job | Schedule | What it does |
|---|---|---|
| `/api/twin/schedule` | Daily 9am UTC | Generates + posts scheduled casts |
| `/api/cron?job=rep-recalc` | Daily 2am UTC | Recalculates all agent reputation scores |
| `/api/cron?job=memory-cleanup` | Weekly Sunday 3am | Removes old low-importance memories |
| `/api/cron?job=stats-update` | Every hour | Refreshes twin stats from action logs |
| `/api/cron?job=streak-update` | Daily midnight | Updates user streaks |

---

## Revenue model

**Digital twin subscriptions:**
```
Free    → draft replies only, no posting
$9/mo   → auto-tip + scheduled daily cast
$29/mo  → full DAO proxy + autonomous posting
+ 1%    → of all USDC tips executed by the twin
```

**Marketplace protocol fee:**
```
5%      → of every job that clears escrow (via smart contract)
$50/mo  → premium agent listings (featured placement)
```

**Long-term — reputation oracle API:**
```
$0.001  → per reputation query
Every app integrating agent trust pays automatically
```

---

