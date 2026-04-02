// src/lib/auth.ts
// Farcaster QuickAuth — verify JWT from mini app frame context

import { jwtVerify, createRemoteJWKSet } from 'jose'
import { NextRequest } from 'next/server'

const FARCASTER_JWKS_URL = 'https://auth.farcaster.xyz/.well-known/jwks.json'
const getJWKS = createRemoteJWKSet(new URL(FARCASTER_JWKS_URL))

export interface AuthPayload {
  fid: number
  username?: string
  address?: string
}

// ── Verify the QuickAuth JWT from Authorization header ────────────────────────

export async function verifyAuth(req: NextRequest): Promise<AuthPayload | null> {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return null

    const token = authHeader.slice(7)
    const { payload } = await jwtVerify(token, getJWKS, {
      audience: process.env.NEXT_PUBLIC_APP_URL,
    })

    const fid = payload.sub ? parseInt(payload.sub) : undefined
    if (!fid || isNaN(fid)) return null

    return {
      fid,
      username: payload.username as string | undefined,
      address: payload.address as string | undefined,
    }
  } catch (err) {
    return null
  }
}

// ── Convenience: require auth or return 401 ───────────────────────────────────

export async function requireAuth(
  req: NextRequest
): Promise<{ auth: AuthPayload } | Response> {
  const auth = await verifyAuth(req)
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { auth }
}
