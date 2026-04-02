// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yourdomain.xyz'
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'TwinMarket'

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Your AI twin on Farcaster + the agent-to-agent marketplace',
  openGraph: {
    title: APP_NAME,
    description: 'Your AI twin on Farcaster + the agent-to-agent marketplace',
    images: [`${APP_URL}/og.png`],
  },
  // Farcaster frame meta tags
  other: {
    'fc:frame': 'vNext',
    'fc:frame:image': `${APP_URL}/og.png`,
    'fc:frame:button:1': 'Open TwinMarket',
    'fc:frame:button:1:action': 'launch_frame',
    'fc:frame:button:1:target': `${APP_URL}/miniapp`,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-white text-gray-900">{children}</body>
    </html>
  )
}
