// src/app/api/twin/stats/route.ts
// Returns stats for the shareable twin card
// Also has a public endpoint for sharing (no auth needed for read)

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { eq, count } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const publicFid = searchParams.get('fid') // public share — no auth needed

  let fid: number

  if (publicFid) {
    fid = parseInt(publicFid)
    if (isNaN(fid)) {
      return NextResponse.json({ error: 'Invalid fid' }, { status: 400 })
    }
  } else {
    const authResult = await requireAuth(req)
    if (authResult instanceof Response) return authResult
    fid = authResult.auth.fid
  }

  // Fetch all stats in one query
  const [statsRow] = await db.execute(sql`
    SELECT
      u.username,
      u.display_name,
      u.pfp_url,
      COALESCE(ts.drafts_shown, 0)    as drafts_shown,
      COALESCE(ts.drafts_approved, 0) as drafts_approved,
      COALESCE(ts.casts_posted, 0)    as casts_posted,
      COALESCE(ts.tips_sent, 0)       as tips_sent,
      COALESCE(ts.usdc_tipped, 0)     as usdc_tipped,
      COALESCE(ts.streak_days, 0)     as streak_days,
      COALESCE(ts.votes_cast, 0)      as votes_cast,
      ts.last_action_at,
      (SELECT COUNT(*) FROM memories m WHERE m.fid = ${fid}) as memory_count,
      (SELECT COUNT(*) FROM twin_actions ta
       WHERE ta.fid = ${fid} AND ta.status = 'executed'
       AND ta.created_at > NOW() - INTERVAL '7 days') as actions_this_week
    FROM users u
    LEFT JOIN twin_stats ts ON ts.fid = u.fid
    WHERE u.fid = ${fid}
  `) as any[]

  if (!statsRow) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const approvalRate =
    statsRow.drafts_shown > 0
      ? Math.round((statsRow.drafts_approved / statsRow.drafts_shown) * 100)
      : 0

  return NextResponse.json({
    fid,
    username: statsRow.username,
    displayName: statsRow.display_name,
    pfpUrl: statsRow.pfp_url,
    stats: {
      draftsShown:     parseInt(statsRow.drafts_shown),
      draftsApproved:  parseInt(statsRow.drafts_approved),
      approvalRate,
      castsPosted:     parseInt(statsRow.casts_posted),
      tipsSent:        parseInt(statsRow.tips_sent),
      usdcTipped:      parseFloat(statsRow.usdc_tipped).toFixed(2),
      votesCast:       parseInt(statsRow.votes_cast),
      streakDays:      parseInt(statsRow.streak_days),
      memoriesStored:  parseInt(statsRow.memory_count),
      actionsThisWeek: parseInt(statsRow.actions_this_week),
    },
    shareUrl: `${process.env.NEXT_PUBLIC_APP_URL}/miniapp?share=${fid}`,
    lastActionAt: statsRow.last_action_at,
  })
}
