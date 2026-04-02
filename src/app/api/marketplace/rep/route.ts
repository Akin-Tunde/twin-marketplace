// src/app/api/marketplace/rep/route.ts
// Reputation leaderboard + individual agent rep history

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agentRegistry, users } from '@/lib/db/schema'
import { eq, desc, sql as drizzleSql } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

// ── GET: leaderboard ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const agentFid  = searchParams.get('fid')
  const limit     = parseInt(searchParams.get('limit') ?? '20')

  if (agentFid) {
    // Individual agent history
    const fid = parseInt(agentFid)
    const agent = await db.query.agentRegistry.findFirst({
      where: eq(agentRegistry.fid, fid),
    })
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const snapshots = await db.execute(sql`
      SELECT score, total_jobs, success_rate, snapshotted_at
      FROM reputation_snapshots
      WHERE agent_fid = ${fid}
      ORDER BY snapshotted_at DESC
      LIMIT 30
    `)

    const events = await db.execute(sql`
      SELECT event_type, score_delta, metadata, created_at
      FROM reputation_events
      WHERE agent_fid = ${fid}
      ORDER BY created_at DESC
      LIMIT 20
    `)

    return NextResponse.json({
      agent: {
        fid: agent.fid,
        name: agent.name,
        reputationScore: agent.reputationScore,
        totalJobs: agent.totalJobs,
        successRate: agent.successRate,
        totalEarningsUsdc: agent.totalEarningsUsdc,
        capabilities: agent.capabilities,
        supportedIntents: agent.supportedIntents,
      },
      history: snapshots,
      recentEvents: events,
    })
  }

  // Full leaderboard
  const leaderboard = await db.execute(sql`
    SELECT
      ar.fid,
      ar.name,
      ar.description,
      ar.reputation_score,
      ar.total_jobs,
      ar.success_rate,
      ar.price_floor_usdc,
      ar.total_earnings_usdc,
      ar.supported_intents,
      ar.capabilities,
      ar.is_verified,
      ar.avg_completion_ms,
      u.pfp_url,
      u.username,
      RANK() OVER (ORDER BY ar.reputation_score DESC) as rank
    FROM agent_registry ar
    JOIN users u ON u.fid = ar.fid
    WHERE ar.is_active = TRUE
    ORDER BY ar.reputation_score DESC
    LIMIT ${limit}
  `)

  // Category breakdown
  const byIntent = await db.execute(sql`
    SELECT
      unnest(supported_intents) as intent,
      COUNT(*) as agent_count,
      AVG(reputation_score) as avg_score
    FROM agent_registry
    WHERE is_active = TRUE
    GROUP BY intent
    ORDER BY agent_count DESC
  `)

  return NextResponse.json({
    leaderboard,
    byIntent,
    total: (leaderboard as any[]).length,
  })
}
