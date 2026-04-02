#!/usr/bin/env tsx
// scripts/test-connections.ts
// Run this before starting dev to verify all services are connected

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function check(name: string, fn: () => Promise<any>) {
  process.stdout.write(`  Checking ${name}... `)
  try {
    await fn()
    console.log('✓')
    return true
  } catch (err: any) {
    console.log(`✗ — ${err.message}`)
    return false
  }
}

async function main() {
  console.log('\n🔍 Testing all connections...\n')
  const results: boolean[] = []

  // 1. Database
  results.push(await check('Database (Neon)', async () => {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(process.env.DATABASE_URL!)
    await sql`SELECT 1`
  }))

  // 2. pgvector
  results.push(await check('pgvector extension', async () => {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(process.env.DATABASE_URL!)
    await sql`SELECT '[1,2,3]'::vector(3)`
  }))

  // 3. Neynar
  results.push(await check('Neynar API', async () => {
    const res = await fetch('https://api.neynar.com/v2/farcaster/user/bulk?fids=1', {
      headers: { 'api_key': process.env.NEYNAR_API_KEY! },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }))

  // 4. Anthropic
  results.push(await check('Anthropic Claude', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }],
    })
  }))

  // 5. OpenAI embeddings
  results.push(await check('OpenAI Embeddings', async () => {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
    await client.embeddings.create({ model: 'text-embedding-3-small', input: 'test' })
  }))

  // 6. Alchemy (Base)
  results.push(await check('Alchemy / Base RPC', async () => {
    const res = await fetch(
      `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }))

  const passed = results.filter(Boolean).length
  const total = results.length
  console.log(`\n${passed === total ? '✅' : '⚠️'}  ${passed}/${total} connections OK\n`)

  if (passed < total) {
    console.log('Fix the failing checks above, then run: npm run dev\n')
    process.exit(1)
  } else {
    console.log('All good! Run: npm run dev\n')
  }
}

main()
