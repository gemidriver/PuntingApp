import React from 'react';

type Props = {
  activeScreen: string;
  setActiveScreen: (s: string) => void;
  showLogout?: boolean;
  onLogout?: () => void;
};

export default function MobileBottomNav({ activeScreen, setActiveScreen, showLogout = false, onLogout }: Props) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 flex lg:hidden">
      <button
        onClick={() => setActiveScreen('home')}
        className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'home' ? 'text-blue-600' : 'text-slate-500'}`}>
        <span className="text-xl leading-none">🏠</span>
        <span>Home</span>
      </button>

      <button
        onClick={() => setActiveScreen('main')}
        className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'main' ? 'text-blue-600' : 'text-slate-500'}`}>
        <span className="text-xl leading-none">🏇</span>
        <span>Picks</span>
      </button>

      <button
        onClick={() => setActiveScreen('leaderboard')}
        className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'leaderboard' ? 'text-blue-600' : 'text-slate-500'}`}>
        <span className="text-xl leading-none">🏆</span>
        <span>Leaderboard</span>
      </button>

      <button
        onClick={() => setActiveScreen('submissions')}
        className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'submissions' ? 'text-blue-600' : 'text-slate-500'}`}>
        <span className="text-xl leading-none">📋</span>
        <span>Submissions</span>
      </button>

      {showLogout && (
        <button
          onClick={() => onLogout && onLogout()}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium text-slate-700`}
        >
          <span className="text-xl leading-none">⎋</span>
          <span>Log out</span>
        </button>
      )}
    </nav>
  );
}
