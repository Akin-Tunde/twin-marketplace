// src/app/api/notifications/save/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { notificationTokens } from '@/lib/db/schema'

export async function POST(req: NextRequest) {
  const { fid, token, url } = await req.json()
  if (!fid || !token || !url) {
    return NextResponse.json({ error: 'fid, token, url required' }, { status: 400 })
  }

  await db
    .insert(notificationTokens)
    .values({ fid, token, url })
    .onConflictDoUpdate({
      target: notificationTokens.fid,
      set: { token, url, updatedAt: new Date() },
    })

  return NextResponse.json({ ok: true })
}
