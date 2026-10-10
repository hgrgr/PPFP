import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hgrgr.ppfp',
  appName: 'PPFP',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    // Native HTTP for fetch: broker, Upbit and public-data APIs answer without CORS headers
    CapacitorHttp: { enabled: true },
    LocalNotifications: { smallIcon: 'ic_stat_ppfp', iconColor: '#2a78d6' },
  },
};

export default config;
