import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.thetoppunter.app',
  appName: 'The Top Punter',
  webDir: 'out',
  server: {
    url: 'https://thetoppunter.com',
    cleartext: true,
  },
};

export default config;
