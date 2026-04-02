// src/app/.well-known/farcaster.json/route.ts
// Farcaster mini app manifest — required for discovery in Warpcast

import { NextResponse } from 'next/server'

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  return NextResponse.json({
    accountAssociation: {
      // Fill this after running: npx @farcaster/create-mini-app
      // or sign manually at: https://warpcast.com/~/developers/mini-apps
      header: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9',
      payload: 'REPLACE_WITH_YOUR_PAYLOAD',
      signature: 'REPLACE_WITH_YOUR_SIGNATURE',
    },
    frame: {
      version: '1',
      name: process.env.NEXT_PUBLIC_APP_NAME ?? 'TwinMarket',
      iconUrl: `${appUrl}/icon.png`,
      homeUrl: `${appUrl}/miniapp`,
      imageUrl: `${appUrl}/og.png`,
      screenshotUrls: [],
      tags: ['ai', 'agent', 'productivity'],
      primaryCategory: 'productivity',
      webhookUrl: `${appUrl}/api/twin/ingest`,
      splashImageUrl: `${appUrl}/splash.png`,
      splashBackgroundColor: '#7C3AED',
    },
  })
}
