import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['exceljs'],
  // Balance files (CSV/XLSX) are uploaded through a server action; the default limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
