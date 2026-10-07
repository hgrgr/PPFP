import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PPFP 포트폴리오',
    short_name: 'PPFP',
    description: '계층형 포트폴리오, Tax Lot, 기간 분석',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f4f5f7',
    theme_color: '#17191c',
    lang: 'ko',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
