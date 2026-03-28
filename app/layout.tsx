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
  description: "Powered by ChapStackDev.",
  icons: {
    icon: "/TheTopPunter.png?v=20260323",
    shortcut: "/TheTopPunter.png?v=20260323",
    apple: "/TheTopPunter.png?v=20260323",
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
