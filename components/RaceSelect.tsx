import React, { useEffect, useRef, useState } from 'react';

type Option = {
  raceId: string;
  label: string;
  updated?: boolean;
  completed?: boolean;
};

type Props = {
  options: Option[];
  value: string;
  onChange: (raceId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

export default function RaceSelect({ options, value, onChange, disabled, placeholder = 'Select race', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  useEffect(() => {
    if (!open || !ref.current) {
      setDropdownStyle(null);
      return;
    }

    const compute = () => {
      const btn = ref.current?.querySelector('button');
      if (!btn) return;
      const rect = (btn as HTMLElement).getBoundingClientRect();
      const top = rect.bottom + window.scrollY;
      // prefer a larger min width but clamp to viewport
      const preferredMin = 520;
      const maxAllowed = Math.floor(window.innerWidth * 0.9);
      const minWidth = Math.min(Math.max(preferredMin, rect.width), maxAllowed);
      let left = rect.left + window.scrollX;
      if (left + minWidth > window.innerWidth) {
        left = Math.max(12, window.innerWidth - minWidth - 12);
      }

      setDropdownStyle({ position: 'fixed', left, top, minWidth, zIndex: 9999, maxHeight: '60vh', overflow: 'auto' });
    };

    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  const selected = options.find((o) => o.raceId === value);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        className={`w-full text-left rounded border border-slate-300 bg-white px-3 py-2 text-sm ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <div className="flex items-center justify-between">
          <div className="truncate">{selected ? selected.label : placeholder}</div>
          <svg className="ml-2 h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </div>
      </button>

      {open && (
        <div style={dropdownStyle as any} className="rounded border border-slate-200 bg-white shadow-lg">
          {options.map((opt, idx) => (
            <div
              key={opt.raceId}
              onMouseEnter={() => setHighlighted(idx)}
              onMouseLeave={() => setHighlighted(null)}
              onClick={() => {
                onChange(opt.raceId);
                setOpen(false);
              }}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${highlighted === idx ? 'bg-slate-100' : ''}`}
            >
              <div className="truncate" style={{ maxWidth: '70%' }}>{opt.label}</div>
              <div className="flex items-center gap-2">
                {opt.completed ? (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-700">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden></span>
                    <span>Completed</span>
                  </span>
                ) : opt.updated ? (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-700">
                    <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden></span>
                    <span>Updated</span>
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
