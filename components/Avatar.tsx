import React from 'react';

interface AvatarProps {
  username: string;
  avatarUrl?: string;
  size?: number;
  onClick?: () => void;
}

// Helper to get initials from username
function getInitials(username: string) {
  if (!username) return '';
  const parts = username.split(/[^a-zA-Z0-9]/).filter(Boolean);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const colors = [
  '#f59e42', '#2563eb', '#d97706', '#059669', '#a21caf',
  '#e11d48', '#0ea5e9', '#fbbf24', '#10b981', '#6366f1',
];

export default function Avatar({ username, avatarUrl, size = 36, onClick }: AvatarProps) {
  const initials = getInitials(username);
  // Pick a color based on username hash
  const color = colors[(username.charCodeAt(0) + username.length) % colors.length];

  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: avatarUrl ? 'transparent' : color,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        border: '2px solid #fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
      title={username}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ color: '#fff', fontWeight: 700, fontSize: size * 0.45 }}>{initials}</span>
      )}
    </span>
  );
}