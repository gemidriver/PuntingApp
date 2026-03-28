"use client";
import ClientVersionCheck from "./client-version-check";

import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';

const ChatFloatingButton = dynamic(() => import('./chat-floating-button'), { ssr: false });

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthScreen = pathname === '/' || pathname === '/login' || pathname === '/register';
  return (
    <>
      <ClientVersionCheck />
      {isAuthScreen ? (
        children
      ) : (
        <>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 8px' }}>
            {children}
          </div>
          <ChatFloatingButton />
        </>
      )}
    </>
  );
}
