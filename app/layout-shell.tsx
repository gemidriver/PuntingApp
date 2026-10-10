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
  const [isMobile, setIsMobile] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const nextTheme = stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light');
    setTheme(nextTheme);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('theme-dark', theme === 'dark');
    root.style.colorScheme = theme;
    try {
      window.localStorage.setItem('theme', theme);
    } catch {
      // ignore storage errors in private modes
    }
  }, [theme]);

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

  const themeTogglePositionClass = user
    ? (isMobile ? 'right-4 top-16' : 'left-[18rem] top-4')
    : 'left-4 top-4';

  return (
    <AllUsersProvider>
      <ClientVersionCheck />
      <button
        type="button"
        onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        className={`theme-toggle fixed ${themeTogglePositionClass} z-[100] rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-100`}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
      </button>
      <div style={{ width: '100%', minHeight: '100vh', padding: '8px 8px 16px 8px', boxSizing: 'border-box', overflow: isMobile ? 'hidden' : 'auto' }}>
        {children}
      </div>
      {/* Chat handled in top toolbar; do not render floating chat button here */}
      {user && <MobileBottomNav activeScreen={activeScreen} setActiveScreen={handleSetActive} showLogout={false} onLogout={handleLogout} />}
    </AllUsersProvider>
  );
}
