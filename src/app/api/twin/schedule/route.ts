// src/app/api/twin/schedule/route.ts
// Vercel cron calls this daily at 9am UTC
// Generates and optionally posts scheduled casts for all opted-in users
//
// Add to vercel.json:
// { "crons": [{ "path": "/api/twin/schedule", "schedule": "0 9 * * *" }] }

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateScheduledCast } from '@/lib/claude'
import { castOnBehalf, sendNotification } from '@/lib/neynar'
import { sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  // Verify this is a legitimate Vercel cron call (or internal test)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('Running scheduled cast job...')

  try {
    // Get all users with scheduled casting enabled
    const users = await db.execute(sql`
      SELECT
        u.fid,
        u.username,
        ts.scheduled_cast_topics,
        ts.autonomy_level,
        ts.signer_uuid,
        nt.token as notif_token,
        nt.url as notif_url
      FROM twin_settings ts
      JOIN users u ON u.fid = ts.fid
      LEFT JOIN notification_tokens nt ON nt.fid = ts.fid
      WHERE ts.scheduled_cast_enabled = TRUE
        AND ts.signer_uuid IS NOT NULL
    `)

    const results = { processed: 0, posted: 0, queued: 0, failed: 0 }

    for (const user of users as any[]) {
      try {
        const topics = user.scheduled_cast_topics ?? ['crypto', 'building', 'life']

        // Generate the cast using Claude RAG
        const { cast: draftText, confidence } = await generateScheduledCast({
          fid: user.fid,
          topics,
        })

        if (!draftText || confidence < 0.6) {
          results.failed++
          continue
        }

        // Store scheduled cast
        await db.execute(sql`
          INSERT INTO scheduled_casts (fid, draft_text, confidence, status, scheduled_for)
          VALUES (
            ${user.fid},
            ${draftText},
            ${confidence},
            ${user.autonomy_level >= 3 ? 'approved' : 'pending'},
            NOW()
          )
        `)

        if (user.autonomy_level >= 3 && user.signer_uuid) {
          // High autonomy — post immediately
          const result = await castOnBehalf({
            signerUuid: user.signer_uuid,
            text: draftText,
          })

          await db.execute(sql`
            UPDATE scheduled_casts
            SET status = 'posted',
                posted_at = NOW(),
                cast_hash = ${result.cast.hash}
            WHERE fid = ${user.fid}
              AND status = 'approved'
              AND posted_at IS NULL
            LIMIT 1
          `)

          // Update stats
          await db.execute(sql`
            INSERT INTO twin_stats (fid, casts_posted)
            VALUES (${user.fid}, 1)
            ON CONFLICT (fid) DO UPDATE
            SET casts_posted = twin_stats.casts_posted + 1,
                updated_at = NOW()
          `)

          results.posted++
        } else {
          // Lower autonomy — notify user for approval
          if (user.notif_token && user.notif_url) {
            await sendNotification({
              tokens: [{ token: user.notif_token, url: user.notif_url }],
              title: 'Your twin has a scheduled cast ready',
              body: draftText.slice(0, 80) + (draftText.length > 80 ? '…' : ''),
              targetUrl: `${process.env.NEXT_PUBLIC_APP_URL}/miniapp?tab=inbox`,
            })
          }
          results.queued++
        }

        results.processed++
      } catch (err) {
        console.error(`Scheduled cast failed for FID ${user.fid}:`, err)
        results.failed++
      }
    }

    console.log('Scheduled cast results:', results)
    return NextResponse.json({ ok: true, ...results })
  } catch (err: any) {
    console.error('Schedule job error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
