import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Top Punter',
    short_name: 'TopPunter',
    description: 'Horse racing tips and jackpot competition.',
    id: '/',
    start_url: '/',
    display: 'standalone',
    background_color: '#0c1120',
    theme_color: '#0ea5e9',
    orientation: 'portrait',
    icons: [
      { src: '/TheTopPunter.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
      { src: '/TheTopPunter.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      { src: '/mobile-home.png', sizes: '520x1114', type: 'image/png' },
      { src: '/mobile-results.png', sizes: '523x1111', type: 'image/png' },
    ] as MetadataRoute.Manifest['screenshots'],
  } as MetadataRoute.Manifest;
}
