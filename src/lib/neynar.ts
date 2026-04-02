// src/lib/neynar.ts
// Neynar API wrapper — the social data backbone

import { NeynarAPIClient, Configuration } from '@neynar/nodejs-sdk'

const config = new Configuration({ apiKey: process.env.NEYNAR_API_KEY! })
export const neynar = new NeynarAPIClient(config)

// ── User helpers ──────────────────────────────────────────────────────────────

export async function getUserByFid(fid: number) {
  const res = await neynar.fetchBulkUsers({ fids: [fid] })
  return res.users[0] ?? null
}

export async function getCastHistory(fid: number, limit = 150) {
  const casts: any[] = []
  let cursor: string | undefined

  while (casts.length < limit) {
    const res = await neynar.fetchCastsForUser({
      fid,
      limit: Math.min(50, limit - casts.length),
      cursor,
    })
    casts.push(...res.casts)
    if (!res.next?.cursor || res.casts.length === 0) break
    cursor = res.next.cursor
  }

  return casts
}

export async function getCast(castHash: string) {
  const res = await neynar.lookupCastByHashOrWarpcastUrl({
    identifier: castHash,
    type: 'hash',
  })
  return res.cast
}

export async function getFollowers(fid: number, limit = 100) {
  const res = await neynar.fetchUserFollowers({ fid, limit })
  return res.users
}

// ── Write helpers (requires App Key / signer) ─────────────────────────────────

export async function castOnBehalf({
  signerUuid,
  text,
  replyTo,
}: {
  signerUuid: string
  text: string
  replyTo?: string
}) {
  return neynar.publishCast({
    signerUuid,
    text,
    ...(replyTo ? { parent: replyTo } : {}),
  })
}

export async function reactToCast({
  signerUuid,
  castHash,
  reactionType,
}: {
  signerUuid: string
  castHash: string
  reactionType: 'like' | 'recast'
}) {
  return neynar.publishReactionToCast({
    signerUuid,
    reactionType,
    target: castHash,
  })
}

// ── Notifications ─────────────────────────────────────────────────────────────

export async function sendNotification({
  tokens,
  title,
  body,
  targetUrl,
}: {
  tokens: Array<{ token: string; url: string }>
  title: string
  body: string
  targetUrl: string
}) {
  const results = await Promise.allSettled(
    tokens.map(({ token, url }) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notificationId: crypto.randomUUID(),
          title,
          body,
          targetUrl,
          tokens: [token],
        }),
      })
    )
  )
  return results
}

// ── Webhook signature verification ───────────────────────────────────────────

export async function verifyWebhookSignature(
  body: string,
  signature: string
): Promise<boolean> {
  const secret = process.env.NEYNAR_WEBHOOK_SECRET!
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const sigBytes = Buffer.from(signature.replace('sha256=', ''), 'hex')
  return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(body))
}
