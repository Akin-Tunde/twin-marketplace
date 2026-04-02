#!/usr/bin/env tsx
// scripts/setup-db.ts
// Run ONCE after drizzle-kit push to:
// 1. Enable pgvector extension
// 2. Create the IVFFlat index for fast similarity search
// 3. Seed the DB with a test user

import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  console.log('1. Enabling pgvector extension...')
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  console.log('   ✓ pgvector enabled')

  console.log('2. Creating vector index on memories...')
  // IVFFlat index — best for datasets under 1M rows
  // Adjust lists= based on row count: sqrt(row_count)
  await sql`
    CREATE INDEX IF NOT EXISTS memories_embedding_idx
    ON memories
    USING ivfflat ((embedding::vector(1536)) vector_cosine_ops)
    WITH (lists = 100)
  `
  console.log('   ✓ Vector index created')

  console.log('3. Adding GIN index for intent array search...')
  await sql`
    CREATE INDEX IF NOT EXISTS registry_intents_gin_idx
    ON agent_registry
    USING gin (supported_intents)
  `
  console.log('   ✓ GIN index created')

  console.log('\n✅ Database setup complete!')
  console.log('\nNext steps:')
  console.log('  1. Copy .env.example to .env.local and fill in values')
  console.log('  2. Run: npm run db:push')
  console.log('  3. Run: npx tsx scripts/setup-db.ts')
  console.log('  4. Run: npm run agent:compile')
  console.log('  5. Run: npm run dev')
}

main().catch(err => {
  console.error('Setup failed:', err)
  process.exit(1)
})
