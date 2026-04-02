/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'imagedelivery.net' },
      { protocol: 'https', hostname: '*.cloudflare.com' },
    ],
  },
  // Allow Farcaster clients to embed the mini app
  async headers() {
    return [
      {
        source: '/miniapp',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://warpcast.com https://*.farcaster.xyz",
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
