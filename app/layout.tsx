import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
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
    capable: true,
    statusBarStyle: "black-translucent",
    title: "The Top Punter",
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
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
