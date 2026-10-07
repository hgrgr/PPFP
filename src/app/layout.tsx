import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_KR } from 'next/font/google';
import { currentUser } from '@/server/auth';
import './globals.css';

const sans = IBM_Plex_Sans_KR({ weight: ['400', '500', '600', '700'], subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'PPFP', template: '%s · PPFP' },
  description: '계층형 포트폴리오, Tax Lot, 기간 분석을 한 곳에서',
  applicationName: 'PPFP',
  appleWebApp: { capable: true, title: 'PPFP', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="ko" className={sans.variable} data-redup={user ? String(user.redUp) : 'true'} suppressHydrationWarning>
      <head>
        {/* restore privacy mode before paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(localStorage.getItem('ppfp-privacy')==='on')document.documentElement.dataset.privacy='on'}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
