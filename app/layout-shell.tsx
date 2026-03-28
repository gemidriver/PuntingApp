"use client";
import ClientVersionCheck from "./client-version-check";

import { usePathname } from 'next/navigation';

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  // Detect login/register screen by path
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const isAuthScreen = pathname === '/' || pathname === '/login' || pathname === '/register';
  return (
    <>
      <ClientVersionCheck />
      {isAuthScreen ? (
        children
      ) : (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 8px' }}>
          {children}
        </div>
      )}
    </>
  );
}
