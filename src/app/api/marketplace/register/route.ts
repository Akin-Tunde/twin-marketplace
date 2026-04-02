// src/app/api/marketplace/register/route.ts
// Agent registration endpoint — accepts agent.json URL, validates it,
// stores in registry using the farcaster-agent-sdk

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { FarcasterAgent } from 'farcaster-agent-sdk'
import { ManifestValidator } from 'farcaster-agent-sdk/manifest'
import { db } from '@/lib/db'
import { users, agentRegistry } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getUserByFid } from '@/lib/neynar'

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { agentJsonUrl } = await req.json()
  if (!agentJsonUrl) {
    return NextResponse.json({ error: 'agentJsonUrl required' }, { status: 400 })
  }

  try {
    // 1. Load and validate the agent.json using farcaster-agent-sdk
    const agent = await FarcasterAgent.load(agentJsonUrl, {
      executor: { defaultContext: { baseUrl: agentJsonUrl.replace('/agent.json', '') } },
    })

    const validator = new ManifestValidator()
    const { valid, errors, warnings } = validator.validate(agent.manifest)

    if (!valid) {
      return NextResponse.json({
        error: 'Invalid agent.json',
        details: errors,
        warnings,
      }, { status: 400 })
    }

    const manifest = agent.manifest

    // 2. Extract supported intents from actions
    const supportedIntents = [
      ...new Set(
        manifest.actions
          ?.map((a: any) => a.intent)
          .filter(Boolean) ?? []
      ),
    ] as string[]

    // 3. Extract pricing from action metadata
    const prices = manifest.actions
      ?.map((a: any) => a.metadata?.priceUsdc ?? 0)
      .filter((p: number) => p > 0) ?? []
    const priceFloor = prices.length > 0 ? Math.min(...prices) : 0

    // 4. Upsert user record (mark as agent)
    const fcUser = await getUserByFid(auth.fid)
    await db
      .insert(users)
      .values({
        fid: auth.fid,
        username: fcUser?.username ?? `fid_${auth.fid}`,
        displayName: fcUser?.display_name ?? manifest.name,
        pfpUrl: fcUser?.pfp_url,
        isAgent: true,
        agentJsonUrl,
      })
      .onConflictDoUpdate({
        target: users.fid,
        set: { isAgent: true, agentJsonUrl, updatedAt: new Date() },
      })

    // 5. Upsert agent registry
    const [registry] = await db
      .insert(agentRegistry)
      .values({
        fid: auth.fid,
        agentJsonUrl,
        name: manifest.name ?? `Agent FID ${auth.fid}`,
        description: manifest.description,
        capabilities: (manifest.capabilities as string[]) ?? [],
        supportedIntents,
        priceFloorUsdc: priceFloor,
        isActive: true,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: agentRegistry.fid,
        set: {
          agentJsonUrl,
          name: manifest.name,
          description: manifest.description,
          capabilities: (manifest.capabilities as string[]) ?? [],
          supportedIntents,
          priceFloorUsdc: priceFloor,
          isActive: true,
          lastSeenAt: new Date(),
        },
      })
      .returning()

    return NextResponse.json({
      success: true,
      fid: auth.fid,
      name: registry.name,
      supportedIntents,
      capabilities: registry.capabilities,
      reputationScore: registry.reputationScore,
      warnings: warnings?.length ? warnings : undefined,
      summary: agent.summary(),
    })
  } catch (err: any) {
    console.error('Registration error:', err)
    if (err.message?.includes('fetch')) {
      return NextResponse.json({
        error: 'Could not load agent.json from the provided URL',
        url: agentJsonUrl,
      }, { status: 400 })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── GET: list all registered agents ──────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const intent = searchParams.get('intent')
  const minRep = parseFloat(searchParams.get('minRep') ?? '0')

  let agents = await db.query.agentRegistry.findMany({
    where: eq(agentRegistry.isActive, true),
    orderBy: (t, { desc }) => [desc(t.reputationScore)],
    limit: 50,
  })

  // Filter by intent if requested
  if (intent) {
    agents = agents.filter(a => a.supportedIntents?.includes(intent))
  }

  // Filter by min reputation
  agents = agents.filter(a => (a.reputationScore ?? 0) >= minRep)

  return NextResponse.json({ agents, total: agents.length })
}
