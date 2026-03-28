"use client";
import ClientVersionCheck from "./client-version-check";
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AllUsersProvider } from './all-users-provider';
import { useUser } from "../lib/useUser";

const ChatFloatingButton = dynamic(() => import('./chat-floating-button'), { ssr: false });


export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  return (
    <AllUsersProvider>
      <ClientVersionCheck />
      <div style={{ width: '100vw', minHeight: '100vh', padding: '24px 8px', boxSizing: 'border-box' }}>
        {children}
      </div>
      {user && <ChatFloatingButton />}
    </AllUsersProvider>
  );
}
