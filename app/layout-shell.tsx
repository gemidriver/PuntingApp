"use client";
import ClientVersionCheck from "./client-version-check";
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AllUsersProvider } from './all-users-provider';

const ChatFloatingButton = dynamic(() => import('./chat-floating-button'), { ssr: false });

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <AllUsersProvider>
      <ClientVersionCheck />
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 8px' }}>
        {children}
      </div>
      <ChatFloatingButton />
    </AllUsersProvider>
  );
}
