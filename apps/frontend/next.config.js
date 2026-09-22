/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pulse/shared-types'],
  reactStrictMode: true,
  output: 'standalone',
  // When NEXT_PUBLIC_API_URL is unset the app talks to the backend through the
  // same origin (dev server or the frontend container), so no CORS and no
  // extra public port is needed.
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_URL) return [];
    const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
  },
};

module.exports = nextConfig;