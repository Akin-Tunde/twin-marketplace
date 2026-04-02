#!/usr/bin/env tsx
// scripts/migrate-week2.ts
// Run this after Week 1 setup to add Week 2 columns

import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const sql = neon(process.env.DATABASE_URL!)
  console.log('Running Week 2 migrations...\n')

  // Add signer_uuid to twin_settings (App Key storage)
  console.log('1. Adding signer_uuid to twin_settings...')
  await sql`
    ALTER TABLE twin_settings
    ADD COLUMN IF NOT EXISTS signer_uuid TEXT,
    ADD COLUMN IF NOT EXISTS signer_status TEXT DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS signer_granted_at TIMESTAMPTZ
  `
  console.log('   ✓ signer columns added')

  // Add onboarding_complete flag to users
  console.log('2. Adding onboarding fields to users...')
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS survey_completed_at TIMESTAMPTZ
  `
  console.log('   ✓ onboarding columns added')

  // Add stats snapshot table for shareable cards
  console.log('3. Creating twin_stats table...')
  await sql`
    CREATE TABLE IF NOT EXISTS twin_stats (
      fid           INTEGER PRIMARY KEY REFERENCES users(fid),
      drafts_shown  INTEGER DEFAULT 0,
      drafts_approved INTEGER DEFAULT 0,
      casts_posted  INTEGER DEFAULT 0,
      tips_sent     INTEGER DEFAULT 0,
      usdc_tipped   REAL DEFAULT 0,
      votes_cast    INTEGER DEFAULT 0,
      memory_count  INTEGER DEFAULT 0,
      streak_days   INTEGER DEFAULT 0,
      last_action_at TIMESTAMPTZ,
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `
  console.log('   ✓ twin_stats table created')

  // Add schedule table for daily cast jobs
  console.log('4. Creating scheduled_casts table...')
  await sql`
    CREATE TABLE IF NOT EXISTS scheduled_casts (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fid         INTEGER NOT NULL REFERENCES users(fid),
      draft_text  TEXT NOT NULL,
      confidence  REAL,
      status      TEXT DEFAULT 'pending',
      scheduled_for TIMESTAMPTZ NOT NULL,
      posted_at   TIMESTAMPTZ,
      cast_hash   TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `
  console.log('   ✓ scheduled_casts table created')

  console.log('\n✅ Week 2 migrations complete!')
  console.log('\nNow run: npm run dev')
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
