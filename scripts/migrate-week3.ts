#!/usr/bin/env tsx
// scripts/migrate-week3.ts

import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const sql = neon(process.env.DATABASE_URL!)
  console.log('Running Week 3 migrations...\n')

  console.log('1. Adding escrow fields to jobs table...')
  await sql`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS escrow_job_id   BYTEA,
    ADD COLUMN IF NOT EXISTS escrow_locked   BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dispute_reason  TEXT,
    ADD COLUMN IF NOT EXISTS dispute_opened_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispute_resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispute_winner  TEXT
  `
  console.log('   ✓ escrow + dispute columns added to jobs')

  console.log('2. Creating disputes table...')
  await sql`
    CREATE TABLE IF NOT EXISTS disputes (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id        UUID NOT NULL REFERENCES jobs(id),
      opened_by_fid INTEGER NOT NULL,
      reason        TEXT NOT NULL,
      evidence      JSONB,
      status        TEXT DEFAULT 'open',
      resolution    TEXT,
      resolved_by   INTEGER,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `
  console.log('   ✓ disputes table created')

  console.log('3. Creating reputation_snapshots table...')
  await sql`
    CREATE TABLE IF NOT EXISTS reputation_snapshots (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_fid   INTEGER NOT NULL REFERENCES users(fid),
      score       REAL NOT NULL,
      total_jobs  INTEGER NOT NULL,
      success_rate REAL NOT NULL,
      snapshotted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  console.log('   ✓ reputation_snapshots table created')

  console.log('4. Creating escrow_transactions table...')
  await sql`
    CREATE TABLE IF NOT EXISTS escrow_transactions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id          UUID NOT NULL REFERENCES jobs(id),
      tx_type         TEXT NOT NULL,
      tx_hash         TEXT,
      amount_usdc     REAL NOT NULL,
      from_address    TEXT,
      to_address      TEXT,
      block_number    BIGINT,
      status          TEXT DEFAULT 'pending',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `
  console.log('   ✓ escrow_transactions table created')

  console.log('5. Adding agent_json_url snapshot to registry...')
  await sql`
    ALTER TABLE agent_registry
    ADD COLUMN IF NOT EXISTS manifest_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS total_earnings_usdc REAL DEFAULT 0
  `
  console.log('   ✓ registry columns added')

  console.log('\n✅ Week 3 migrations complete!')
}

main().catch(err => { console.error(err); process.exit(1) })
