"use client";
import React from 'react';

type Props = {
  error: Error;
  reset?: () => void;
};

export default function Error({ error, reset }: Props) {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1 style={{ marginTop: 0 }}>An unexpected error occurred</h1>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{error?.message}</pre>
      {typeof reset === 'function' && (
        <button onClick={() => reset()} style={{ marginTop: 12 }}>Try again</button>
      )}
    </div>
  );
}
