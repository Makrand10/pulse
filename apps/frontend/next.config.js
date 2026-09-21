/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pulse/shared-types'],
  reactStrictMode: true,
};

module.exports = nextConfig;