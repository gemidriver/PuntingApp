"use client";
import { useEffect, useRef, useState } from "react";
import { useUser } from "../lib/useUser";
import { useContext } from "react";
import AllUsersContext from "./all-users-context";
import PullNotificationsContext from "./pull-notifications-context";

function ChatFloatingButton() {
  const [open, setOpen] = useState(false);
  // Get all usernames from context
  const allUsers = useContext(AllUsersContext) || {};
  const usernames = Object.keys(allUsers);
  return (
    <>
      <button
        aria-label="Open chat"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 16,
          bottom: 64,
          zIndex: 1001,
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: "50%",
          width: 56,
          height: 56,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          fontSize: 28,
          cursor: "pointer",
        }}
      >
        💬
      </button>
      {open && <ChatModal onClose={() => setOpen(false)} usernames={usernames} />}
    </>
  );
}

export default ChatFloatingButton;

function ChatModal({ onClose, usernames = [] }: { onClose: () => void, usernames?: string[] }) {
    const pullInAppNotifications = useContext(PullNotificationsContext);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mentionList, setMentionList] = useState<string[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const { user, username, userId } = useUser();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchMessages() {
    const res = await fetch("/api/chat");
    const data = await res.json();
    if (data.messages) setMessages(data.messages);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setInput(value);
    // Show mention list if @ is typed
    const match = value.match(/@([\w\d_]*)$/);
    if (match) {
      const search = match[1].toLowerCase();
      setMentionList(usernames.filter(u => u.toLowerCase().startsWith(search)));
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  }

  function handleMentionClick(username: string) {
    // Replace last @... with @username
    setInput(input.replace(/@([\w\d_]*)$/, `@${username} `));
    setShowMentions(false);
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, username, message: input }),
    });
    setInput("");
    setShowMentions(false);
    setLoading(false);
    fetchMessages();
    // Pull notifications immediately after sending
    if (typeof pullInAppNotifications === 'function') {
      pullInAppNotifications();
    }
  }

  // Helper to highlight @username in messages
  function renderMessageText(text: string) {
    const parts = text.split(/(@[\w\d_]+)/g);
    return parts.map((part, i) =>
      part.startsWith('@') ? (
        <span key={i} style={{ color: '#d97706', fontWeight: 600 }}>{part}</span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  }

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.3)",
      zIndex: 1002,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{ background: "#fff", borderRadius: 12, width: 360, maxWidth: "95vw", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 4px 24px rgba(0,0,0,0.18)" }}>
        <div style={{ padding: 16, borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 18, display: "flex", justifyContent: "space-between", alignItems: "center", color: '#222' }}>
          Chat
          <button onClick={onClose} style={{ background: "#2563eb", color: "#fff", border: "none", fontSize: 22, cursor: "pointer", borderRadius: 6, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16, background: "#f9fafb" }}>
          {messages.length === 0 ? (
            <div style={{ color: "#888", textAlign: "center", marginTop: 32 }}>No messages yet.</div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} style={{ marginBottom: 12 }}>
                <span style={{ fontWeight: 500, color: "#2563eb" }}>{msg.username}:</span>{' '}
                <span style={{ color: '#222' }}>{renderMessageText(msg.message)}</span>
                <div style={{ fontSize: 10, color: "#aaa" }}>{new Date(msg.created_at).toLocaleString()}</div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={sendMessage} style={{ display: "flex", borderTop: "1px solid #eee", padding: 8, position: 'relative' }}>
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Type a message..."
            style={{ flex: 1, border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 14, color: '#222' }}
            disabled={loading}
            maxLength={300}
            autoComplete="off"
          />
          {showMentions && mentionList.length > 0 && (
            <div style={{ position: 'absolute', left: 0, bottom: 40, background: '#fff', border: '1px solid #ddd', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', zIndex: 10, maxHeight: 120, overflowY: 'auto', minWidth: 180 }}>
              {mentionList.map(u => (
                <div key={u} style={{ padding: '6px 12px', cursor: 'pointer', color: '#2563eb', fontWeight: 500 }} onMouseDown={() => handleMentionClick(u)}>
                  @{u}
                </div>
              ))}
            </div>
          )}
          <button type="submit" disabled={loading || !input.trim()} style={{ marginLeft: 8, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "0 16px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>Send</button>
        </form>
      </div>
    </div>
  );
}
