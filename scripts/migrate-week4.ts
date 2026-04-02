#!/usr/bin/env tsx
// scripts/migrate-week4.ts

import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const sql = neon(process.env.DATABASE_URL!)
  console.log('Running Week 4 migrations...\n')

  console.log('1. Creating rate_limits table...')
  await sql`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key         TEXT NOT NULL,
      window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      count       INTEGER DEFAULT 1,
      PRIMARY KEY (key, window_start)
    )
  `
  console.log('   ✓ rate_limits table created')

  console.log('2. Creating dao_votes table...')
  await sql`
    CREATE TABLE IF NOT EXISTS dao_votes (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fid           INTEGER NOT NULL REFERENCES users(fid),
      proposal_id   TEXT NOT NULL,
      dao_name      TEXT NOT NULL,
      platform      TEXT NOT NULL,
      proposal_title TEXT,
      proposal_summary TEXT,
      twin_decision TEXT NOT NULL,
      twin_reasoning TEXT,
      confidence    REAL,
      status        TEXT DEFAULT 'pending',
      tx_hash       TEXT,
      voted_at      TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (fid, proposal_id)
    )
  `
  console.log('   ✓ dao_votes table created')

  console.log('3. Creating cron_logs table...')
  await sql`
    CREATE TABLE IF NOT EXISTS cron_logs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_name    TEXT NOT NULL,
      status      TEXT NOT NULL,
      details     JSONB,
      duration_ms INTEGER,
      ran_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `
  console.log('   ✓ cron_logs table created')

  console.log('4. Adding memory metadata column...')
  await sql`
    ALTER TABLE memories
    ADD COLUMN IF NOT EXISTS importance   REAL DEFAULT 0.5,
    ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ
  `
  console.log('   ✓ memory columns added')

  console.log('\n✅ Week 4 migrations complete!')
}

main().catch(err => { console.error(err); process.exit(1) })
