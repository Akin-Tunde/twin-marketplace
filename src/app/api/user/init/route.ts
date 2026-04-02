// src/app/api/user/init/route.ts
// Called once on mini app open — seeds user, kicks off cast ingestion

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, twinSettings, memories } from '@/lib/db/schema'
import { eq, count } from 'drizzle-orm'
import { getUserByFid, getCastHistory } from '@/lib/neynar'
import { ingestCastHistory } from '@/lib/memory'

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  // 1. Upsert user record
  const fcUser = await getUserByFid(auth.fid)

  await db
    .insert(users)
    .values({
      fid: auth.fid,
      username: fcUser?.username ?? `fid_${auth.fid}`,
      displayName: fcUser?.display_name,
      pfpUrl: fcUser?.pfp_url,
      custodyAddr: fcUser?.custody_address,
      bio: fcUser?.profile?.bio?.text,
      followerCount: fcUser?.follower_count ?? 0,
      followingCount: fcUser?.following_count ?? 0,
    })
    .onConflictDoUpdate({
      target: users.fid,
      set: {
        username: fcUser?.username ?? `fid_${auth.fid}`,
        displayName: fcUser?.display_name,
        pfpUrl: fcUser?.pfp_url,
        followerCount: fcUser?.follower_count ?? 0,
        followingCount: fcUser?.following_count ?? 0,
        updatedAt: new Date(),
      },
    })

  // 2. Create default twin settings if missing
  await db
    .insert(twinSettings)
    .values({ fid: auth.fid })
    .onConflictDoNothing()

  // 3. Check if memory needs seeding (new user)
  const [{ count: memCount }] = await db
    .select({ count: count() })
    .from(memories)
    .where(eq(memories.fid, auth.fid))

  let ingested = false
  if (Number(memCount) < 10) {
    // Background: ingest cast history (don't await — return immediately)
    getCastHistory(auth.fid, 150)
      .then(casts => ingestCastHistory(auth.fid, casts))
      .catch(console.error)
    ingested = true
  }

  return NextResponse.json({
    ok: true,
    fid: auth.fid,
    memoryCount: Number(memCount),
    ingestingNow: ingested,
  })
}
