// src/app/api/cron/route.ts
// Master cron endpoint — handles all scheduled background jobs
// Vercel calls this daily via vercel.json
//
// Jobs:
//   daily-schedule  → already handled by /api/twin/schedule
//   rep-recalc      → recalculate all agent reputation scores
//   memory-cleanup  → remove old low-importance memories
//   stats-update    → refresh all twin stats

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agentRegistry, reputationEvents, memories } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')
  if (process.env.CRON_SECRET && secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const job = new URL(req.url).searchParams.get('job') ?? 'all'
  const results: Record<string, any> = {}
  const start = Date.now()

  console.log(`Cron: running job=${job}`)

  try {
    if (job === 'all' || job === 'rep-recalc') {
      results['rep-recalc'] = await recalcAllReputation()
    }

    if (job === 'all' || job === 'memory-cleanup') {
      results['memory-cleanup'] = await cleanupMemories()
    }

    if (job === 'all' || job === 'stats-update') {
      results['stats-update'] = await refreshTwinStats()
    }

    if (job === 'all' || job === 'streak-update') {
      results['streak-update'] = await updateStreaks()
    }

    const duration = Date.now() - start

    // Log cron run
    await db.execute(sql`
      INSERT INTO cron_logs (job_name, status, details, duration_ms)
      VALUES (${job}, 'success', ${JSON.stringify(results)}, ${duration})
    `)

    console.log(`Cron: done in ${duration}ms`, results)
    return NextResponse.json({ ok: true, job, duration, results })
  } catch (err: any) {
    console.error('Cron error:', err)
    await db.execute(sql`
      INSERT INTO cron_logs (job_name, status, details)
      VALUES (${job}, 'error', ${JSON.stringify({ error: err.message })})
    `)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Job: Recalculate all agent reputation scores ──────────────────────────────
async function recalcAllReputation() {
  const agents = await db.query.agentRegistry.findMany()
  let updated = 0

  for (const agent of agents) {
    const events = await db.query.reputationEvents.findMany({
      where: eq(reputationEvents.agentFid, agent.fid),
    })

    const completed   = events.filter(e => e.eventType === 'job_completed').length
    const failed      = events.filter(e => e.eventType === 'job_failed').length
    const totalJobs   = completed + failed
    const successRate = totalJobs > 0 ? completed / totalJobs : 1.0
    const newScore    = Math.min(100, Math.max(0, events.reduce((s, e) => s + e.scoreDelta, 0)))

    await db.execute(sql`
      UPDATE agent_registry
      SET reputation_score = ${newScore}, total_jobs = ${totalJobs}, success_rate = ${successRate}
      WHERE fid = ${agent.fid}
    `)

    // Daily snapshot
    await db.execute(sql`
      INSERT INTO reputation_snapshots (agent_fid, score, total_jobs, success_rate)
      VALUES (${agent.fid}, ${newScore}, ${totalJobs}, ${successRate})
    `)

    updated++
  }

  return { agentsUpdated: updated }
}

// ── Job: Clean up old low-importance memories ─────────────────────────────────
async function cleanupMemories() {
  // Remove memories older than 90 days with low importance & low access
  const result = await db.execute(sql`
    DELETE FROM memories
    WHERE created_at < NOW() - INTERVAL '90 days'
      AND COALESCE(importance, 0.5) < 0.3
      AND COALESCE(access_count, 0) = 0
      AND memory_type = 'cast'
    RETURNING id
  `)
  return { deleted: (result as any[]).length }
}

// ── Job: Refresh twin stats for all users ────────────────────────────────────
async function refreshTwinStats() {
  // Update memory counts from live data
  await db.execute(sql`
    UPDATE twin_stats ts
    SET memory_count = (
      SELECT COUNT(*) FROM memories m WHERE m.fid = ts.fid
    ),
    updated_at = NOW()
  `)

  // Sync action counts from twin_actions table
  await db.execute(sql`
    UPDATE twin_stats ts
    SET
      drafts_shown = (
        SELECT COUNT(*) FROM twin_actions ta
        WHERE ta.fid = ts.fid AND ta.action_type = 'draft'
      ),
      drafts_approved = (
        SELECT COUNT(*) FROM twin_actions ta
        WHERE ta.fid = ts.fid AND ta.action_type = 'draft' AND ta.status = 'executed'
      ),
      casts_posted = (
        SELECT COUNT(*) FROM twin_actions ta
        WHERE ta.fid = ts.fid AND ta.action_type IN ('draft','cast') AND ta.status = 'executed'
      ),
      tips_sent = (
        SELECT COUNT(*) FROM twin_actions ta
        WHERE ta.fid = ts.fid AND ta.action_type = 'tip' AND ta.status = 'executed'
      ),
      votes_cast = (
        SELECT COUNT(*) FROM dao_votes dv
        WHERE dv.fid = ts.fid AND dv.status = 'voted'
      ),
      updated_at = NOW()
  `)

  return { ok: true }
}

// ── Job: Update user streaks ──────────────────────────────────────────────────
async function updateStreaks() {
  // Users who had a twin action today keep/extend streak
  // Users who had no action reset streak to 0
  await db.execute(sql`
    UPDATE twin_stats ts
    SET streak_days = CASE
      WHEN EXISTS (
        SELECT 1 FROM twin_actions ta
        WHERE ta.fid = ts.fid
          AND ta.status = 'executed'
          AND ta.executed_at > NOW() - INTERVAL '26 hours'
      ) THEN streak_days + 1
      ELSE 0
    END,
    last_action_at = (
      SELECT MAX(executed_at) FROM twin_actions ta WHERE ta.fid = ts.fid
    ),
    updated_at = NOW()
  `)

  return { ok: true }
}
