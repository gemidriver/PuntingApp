"use client";
import React, { useState, useEffect } from "react";
import dynamic from 'next/dynamic';
import ClientVersionCheck from "./client-version-check";
import { usePathname, useRouter } from 'next/navigation';
import { AllUsersProvider } from './all-users-provider';
import { useUser } from "../lib/useUser";
import MobileBottomNav from '../components/MobileBottomNav';
import { getSupabaseClient } from '../lib/supabase';
// header avatar moved into page header; keep shell minimal

// Chat button moved into page header to avoid floating overlap


export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const ChatFloatingButton = dynamic(() => import('./chat-floating-button'), { ssr: false });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(typeof window !== 'undefined' && window.innerWidth <= 640);
    }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const router = useRouter();
  const [activeScreen, setActiveScreen] = useState('home');

  const handleSetActive = (s: string) => {
    setActiveScreen(s);
    try {
      if (s === 'home') router.push('/');
      else if (s === 'main') router.push('/#races');
      else if (s === 'leaderboard') router.push('/?screen=leaderboard');
      else if (s === 'submissions') router.push('/?screen=submissions');
      else router.push('/');
    // Notify page listeners (which may rely on popstate/hashchange) that location changed
    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new Event('popstate')); } catch (e) { /* ignore */ }
      try {
        window.dispatchEvent(new CustomEvent('app:setActiveScreen', { detail: s }));
      } catch (e) { /* ignore */ }
    }
    } catch (e) {
      // ignore navigation errors in environments where router isn't available
    }
  };

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // ignore
    }
    try {
      router.push('/');
    } catch (e) {
      // ignore
    }
  };

  return (
    <AllUsersProvider>
      <ClientVersionCheck />
      <div style={{ width: '100%', minHeight: '100vh', padding: '24px 8px', boxSizing: 'border-box' }}>
        {children}
      </div>
      {/* render floating chat button globally for signed-in users (desktop only) */}
      {user && !isMobile ? <ChatFloatingButton /> : null}
      <MobileBottomNav activeScreen={activeScreen} setActiveScreen={handleSetActive} showLogout={Boolean(user)} onLogout={handleLogout} />
    </AllUsersProvider>
  );
}
