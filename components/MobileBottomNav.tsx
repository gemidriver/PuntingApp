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
        className={`flex-1 flex items-end justify-center pb-3 pt-2 ${activeScreen === 'home' ? 'text-blue-600' : 'text-slate-500'}`}>
        <span className="text-2xl leading-none">🏠</span>
      </button>

      <button
        onClick={() => setActiveScreen('main')}
        className={`flex-1 flex items-end justify-center pb-3 pt-2 ${activeScreen === 'main' ? 'text-blue-600' : 'text-slate-500'}`}>
        <span className="text-2xl leading-none">🏇</span>
      </button>

      <button
        onClick={() => setActiveScreen('leaderboard')}
        className={`flex-1 flex items-end justify-center pb-3 pt-2 ${activeScreen === 'leaderboard' ? 'text-blue-600' : 'text-slate-500'}`}>
        <span className="text-2xl leading-none">🏆</span>
      </button>

      <button
        onClick={() => setActiveScreen('submissions')}
        className={`flex-1 flex items-end justify-center pb-3 pt-2 ${activeScreen === 'submissions' ? 'text-blue-600' : 'text-slate-500'}`}>
        <span className="text-2xl leading-none">📋</span>
      </button>

      {showLogout && (
        <button
          onClick={() => onLogout && onLogout()}
          className={`flex-1 flex items-end justify-center pb-3 pt-2 text-slate-700`}
        >
          <span className="text-2xl leading-none">🚪</span>
        </button>
      )}
    </nav>
  );
}
