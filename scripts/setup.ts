#!/usr/bin/env tsx
// scripts/setup.ts
// Run this ONCE after cloning/unzipping:
//   npx tsx scripts/setup.ts
//
// It will:
//   1. Check all required env vars are present
//   2. Test every external connection
//   3. Push DB schema (Drizzle)
//   4. Enable pgvector + create indexes
//   5. Run all migrations (Week 1–4)
//   6. Generate agent.json (compiler)
//   7. Print the start command

import { execSync } from 'child_process'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config({ path: '.env.local' })

const REQUIRED_ENV = [
  'NEYNAR_API_KEY',
  'NEYNAR_WEBHOOK_SECRET',
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'ALCHEMY_API_KEY',
  'NEXT_PUBLIC_APP_URL',
  'MARKETPLACE_WALLET_PRIVATE_KEY',
  'JWT_SECRET',
]

const OPTIONAL_ENV = [
  'ESCROW_CONTRACT_ADDRESS',
  'NEYNAR_APP_FID',
  'TALLY_API_KEY',
  'UPSTASH_REDIS_REST_URL',
  'CRON_SECRET',
  'ADMIN_FIDS',
  'BASESCAN_API_KEY',
]

function step(n: number, label: string) {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Step ${n}: ${label}`)
  console.log('─'.repeat(50))
}

function ok(msg: string) { console.log(`  ✓ ${msg}`) }
function warn(msg: string) { console.log(`  ⚠ ${msg}`) }
function fail(msg: string) { console.log(`  ✗ ${msg}`); process.exit(1) }

async function check(name: string, fn: () => Promise<void>): Promise<boolean> {
  process.stdout.write(`  Checking ${name}... `)
  try {
    await fn()
    console.log('✓')
    return true
  } catch (err: any) {
    console.log(`✗  ${err.message}`)
    return false
  }
}

async function main() {
  console.log('\n🚀 TwinMarket — Full Setup\n')
  console.log('This will configure your database and test all connections.')

  // ── 0. Check .env.local exists ────────────────────────────────────────────
  step(0, 'Environment file check')

  if (!fs.existsSync('.env.local')) {
    warn('.env.local not found — copying from .env.example')
    fs.copyFileSync('.env.example', '.env.local')
    fail('Please fill in .env.local then re-run this script.')
  }
  ok('.env.local found')

  // ── 1. Check required env vars ────────────────────────────────────────────
  step(1, 'Required environment variables')

  const missing = REQUIRED_ENV.filter(k => !process.env[k])
  if (missing.length > 0) {
    missing.forEach(k => warn(`Missing: ${k}`))
    fail(`Add the above to .env.local then re-run.`)
  }
  ok(`All ${REQUIRED_ENV.length} required vars present`)

  const missingOptional = OPTIONAL_ENV.filter(k => !process.env[k])
  if (missingOptional.length > 0) {
    missingOptional.forEach(k => warn(`Optional (not required): ${k}`))
  }

  // ── 2. Test connections ───────────────────────────────────────────────────
  step(2, 'Testing external connections')

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(process.env.DATABASE_URL!)

  const passed: boolean[] = []

  passed.push(await check('Neon Postgres', async () => {
    await sql`SELECT 1`
  }))

  passed.push(await check('Anthropic Claude', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    await c.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })
  }))

  passed.push(await check('OpenAI Embeddings', async () => {
    const OpenAI = (await import('openai')).default
    const c = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
    await c.embeddings.create({ model: 'text-embedding-3-small', input: 'test' })
  }))

  passed.push(await check('Neynar API', async () => {
    const res = await fetch('https://api.neynar.com/v2/farcaster/user/bulk?fids=1', {
      headers: { 'api_key': process.env.NEYNAR_API_KEY! },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }))

  passed.push(await check('Alchemy / Base RPC', async () => {
    const res = await fetch(`https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }))

  const allPassed = passed.filter(Boolean).length
  console.log(`\n  ${allPassed}/${passed.length} connections OK`)
  if (allPassed < passed.length) {
    fail('Fix failing connections above, then re-run.')
  }

  // ── 3. Push DB schema ─────────────────────────────────────────────────────
  step(3, 'Pushing database schema (Drizzle)')
  try {
    execSync('npx drizzle-kit push --yes', { stdio: 'inherit' })
    ok('Schema pushed')
  } catch {
    fail('drizzle-kit push failed. Check DATABASE_URL.')
  }

  // ── 4. Enable pgvector + indexes ──────────────────────────────────────────
  step(4, 'Enabling pgvector + creating indexes')
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`
    ok('pgvector enabled')

    await sql`
      CREATE INDEX IF NOT EXISTS memories_embedding_idx
      ON memories USING ivfflat ((embedding::vector(1536)) vector_cosine_ops)
      WITH (lists = 100)
    `
    ok('Vector similarity index created')

    await sql`
      CREATE INDEX IF NOT EXISTS registry_intents_gin_idx
      ON agent_registry USING gin (supported_intents)
    `
    ok('GIN intent index created')
  } catch (err: any) {
    fail(`pgvector setup failed: ${err.message}`)
  }

  // ── 5. Run all migrations ─────────────────────────────────────────────────
  step(5, 'Running all migrations (Week 1–4)')

  const migrations = [
    'scripts/migrate-week2.ts',
    'scripts/migrate-week3.ts',
    'scripts/migrate-week4.ts',
  ]

  for (const m of migrations) {
    if (fs.existsSync(m)) {
      try {
        execSync(`npx tsx ${m}`, { stdio: 'pipe' })
        ok(m)
      } catch (err: any) {
        warn(`${m} — ${err.stderr?.toString()?.slice(0, 100) ?? err.message}`)
      }
    }
  }

  // ── 6. Generate agent.json ─────────────────────────────────────────────────
  step(6, 'Generating agent.json (farcaster-agent-compiler)')
  try {
    const url  = process.env.NEXT_PUBLIC_APP_URL!
    execSync(
      `npx agentjson -p . -o ./public/agent.json --auth-type farcaster-frame --url ${url}`,
      { stdio: 'pipe' }
    )
    ok('public/agent.json generated')
  } catch {
    warn('agentjson not installed — run: npm install farcaster-agent-compiler')
    warn('Then run: npm run agent:compile')
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(50))
  console.log('✅  Setup complete!')
  console.log('═'.repeat(50))
  console.log('\nRemaining manual steps:')
  console.log('  1. Create Neynar webhook → https://dev.neynar.com')
  console.log('     URL: ' + process.env.NEXT_PUBLIC_APP_URL + '/api/twin/ingest')
  console.log('     Events: cast.created, cast.reaction.created, follow.created')
  console.log('     Copy the secret → NEYNAR_WEBHOOK_SECRET in .env.local')
  console.log('')
  console.log('  2. Sign your mini app manifest:')
  console.log('     npx @farcaster/create-mini-app --sign-only')
  console.log('     Paste header/payload/signature into:')
  console.log('     src/app/.well-known/farcaster.json/route.ts')
  console.log('')
  console.log('  3. (Optional) Deploy escrow contract to Base Sepolia:')
  console.log('     npm install --save-dev hardhat @nomicfoundation/hardhat-ethers @openzeppelin/contracts')
  console.log('     npx hardhat compile')
  console.log('     npx hardhat run scripts/deploy-escrow.ts --network base-sepolia')
  console.log('     Add ESCROW_CONTRACT_ADDRESS to .env.local')
  console.log('')
  console.log('─'.repeat(50))
  console.log('\n▶  Start the app:')
  console.log('   npm run dev')
  console.log('')
  console.log('▶  Test in Warpcast:')
  console.log('   https://warpcast.com/~/developers/frames')
  console.log('   Paste: ' + process.env.NEXT_PUBLIC_APP_URL + '/miniapp')
  console.log('')
}

main().catch(err => {
  console.error('\nSetup failed:', err.message)
  process.exit(1)
})
