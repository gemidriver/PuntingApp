import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

import LayoutShell from "./layout-shell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "The Top Punter",
  description: "Horse racing tips and jackpot competition.",
  applicationName: "The Top Punter",
  appleWebApp: {
    statusBarStyle: "black-translucent",
    title: "The Top Punter",
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  icons: {
    icon: "/TheTopPunter.png",
    shortcut: "/TheTopPunter.png",
    apple: "/TheTopPunter.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shouldRegisterServiceWorker = process.env.NODE_ENV === 'production';

  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        {shouldRegisterServiceWorker ? (
          <Script id="register-sw" strategy="afterInteractive">{`
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.register('/sw.js');
            }
          `}</Script>
        ) : null}
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
