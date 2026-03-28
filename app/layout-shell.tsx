"use client";
import ClientVersionCheck from "./client-version-check";
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AllUsersProvider } from './all-users-provider';
import { useState, useEffect } from 'react';

const ChatFloatingButton = dynamic(() => import('./chat-floating-button'), { ssr: false });

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    // Check for user in localStorage/sessionStorage or via Supabase if needed
    const user = typeof window !== 'undefined' ? localStorage.getItem('sb-user') : null;
    setIsLoggedIn(!!user);
  }, []);
  return (
    <AllUsersProvider>
      <ClientVersionCheck />
      <div style={{ width: '100vw', minHeight: '100vh', padding: '24px 8px', boxSizing: 'border-box' }}>
        {children}
      </div>
      {isLoggedIn && <ChatFloatingButton />}
    </AllUsersProvider>
  );
}
