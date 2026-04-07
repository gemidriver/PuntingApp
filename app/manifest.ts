import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Top Punter',
    short_name: 'TopPunter',
    description: 'Horse racing tips and jackpot competition.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0c1120',
    theme_color: '#0ea5e9',
    orientation: 'portrait',
    icons: [
      { src: '/TheTopPunter.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/TheTopPunter.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
