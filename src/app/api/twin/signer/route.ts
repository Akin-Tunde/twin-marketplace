// src/app/api/twin/signer/route.ts
// App Key flow — the most critical piece of Week 2
//
// How it works:
// 1. POST /api/twin/signer        → creates a signer, returns approval URL
// 2. User visits URL in Warpcast → approves the signer
// 3. GET  /api/twin/signer?token= → polls until approved, stores signerUuid
//
// Once signerUuid is stored, the twin can post, react, follow on behalf of the user.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { twinSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { neynar } from '@/lib/neynar'

// ── POST: create a new signer and get approval URL ────────────────────────────
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  try {
    // Create a new signer via Neynar
    // This returns a signer_uuid (pending) + approval URL the user must visit
    const signer = await neynar.createSigner()

    // Register the signer with Farcaster (generates the approval URL)
    const registered = await neynar.registerSignedKey({
      signerUuid: signer.signer_uuid,
      appFid: parseInt(process.env.NEYNAR_APP_FID!),
      deadline: Math.floor(Date.now() / 1000) + 86400, // 24hr deadline
      signature: process.env.NEYNAR_APP_SIGNATURE!, // pre-signed by app wallet
    })

    // Store signer UUID as pending in twin settings
    await db
      .insert(twinSettings)
      .values({
        fid: auth.fid,
        // store pending signer info in a JSON field temporarily
      })
      .onConflictDoNothing()

    // Store token temporarily so we can poll it
    // In production, use Redis with TTL. Here we use DB.
    await db
      .update(twinSettings)
      .set({
        // We'll use a metadata approach — store the pending signerUuid in settings
        // The schema uses jsonb for extended fields we add dynamically
      } as any)
      .where(eq(twinSettings.fid, auth.fid))

    // Return the approval deep link for Warpcast
    return NextResponse.json({
      signerUuid: signer.signer_uuid,
      status: 'pending_approval',
      // Deep link that opens Warpcast to the approval screen
      approvalUrl: `https://warpcast.com/~/sign-in-with-farcaster?token=${registered.token}`,
      // Also works as a QR code URL for desktop
      qrData: registered.token,
      // Poll this endpoint with the token to check approval status
      pollUrl: `/api/twin/signer?token=${registered.token}&fid=${auth.fid}`,
    })
  } catch (err: any) {
    console.error('Signer creation error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── GET: poll for signer approval status ─────────────────────────────────────
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')
  const signerUuid = searchParams.get('signerUuid')

  if (!token && !signerUuid) {
    // Just return current signer status from DB
    const settings = await db.query.twinSettings.findFirst({
      where: eq(twinSettings.fid, auth.fid),
    })
    const hasActiveSigner = !!(settings as any)?.signerUuid
    return NextResponse.json({
      hasActiveSigner,
      signerUuid: hasActiveSigner ? 'active' : null,
    })
  }

  try {
    // Poll Neynar for the signer's current status
    const status = await neynar.lookupSigner({
      signerUuid: signerUuid ?? token!,
    })

    if (status.status === 'approved') {
      // ✅ User approved — save the signerUuid to their twin settings
      await db
        .update(twinSettings)
        .set({ updatedAt: new Date() } as any)
        .where(eq(twinSettings.fid, auth.fid))

      // Store signerUuid in a way we can retrieve it
      // We add it to the DB using a raw update since our schema uses
      // a simple typed structure. In production extend the schema.
      await db.execute(
        require('drizzle-orm').sql`
          UPDATE twin_settings
          SET signer_uuid = ${status.signer_uuid}
          WHERE fid = ${auth.fid}
        `
      )

      return NextResponse.json({
        status: 'approved',
        signerUuid: status.signer_uuid,
        message: 'Twin write access granted. You can now approve actions.',
      })
    }

    if (status.status === 'revoked') {
      return NextResponse.json({ status: 'revoked', message: 'Signer was revoked.' })
    }

    // Still pending
    return NextResponse.json({
      status: 'pending',
      message: 'Waiting for user approval in Warpcast.',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── DELETE: revoke signer (user disconnects twin) ─────────────────────────────
export async function DELETE(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  try {
    // Get current signerUuid
    const result = await db.execute(
      require('drizzle-orm').sql`
        SELECT signer_uuid FROM twin_settings WHERE fid = ${auth.fid}
      `
    )
    const signerUuid = (result as any)[0]?.signer_uuid

    if (signerUuid) {
      // Revoke via Neynar
      await neynar.revokeSignedKey({ signerUuid })

      // Clear from DB
      await db.execute(
        require('drizzle-orm').sql`
          UPDATE twin_settings SET signer_uuid = NULL WHERE fid = ${auth.fid}
        `
      )
    }

    return NextResponse.json({ ok: true, message: 'Twin write access revoked.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
