import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import dynamic from "next/dynamic";
const ClientVersionCheck = dynamic(() => import("./client-version-check"), { ssr: false });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Top Punter",
  description: "Powered by the BrewedBuilder.",
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
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClientVersionCheck />
        {children}
      </body>
    </html>
  );
}
