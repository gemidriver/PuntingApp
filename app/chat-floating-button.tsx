"use client";
import { useEffect, useRef, useState } from "react";
import { useUser } from "../lib/useUser";

export default function ChatFloatingButton() {
  const [open, setOpen] = useState(false);
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
      {open && <ChatModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ChatModal({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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
    setLoading(false);
    fetchMessages();
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
        <div style={{ padding: 16, borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          Chat
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>&times;</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16, background: "#f9fafb" }}>
          {messages.length === 0 ? (
            <div style={{ color: "#888", textAlign: "center", marginTop: 32 }}>No messages yet.</div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} style={{ marginBottom: 12 }}>
                <span style={{ fontWeight: 500, color: "#2563eb" }}>{msg.username}:</span> <span>{msg.message}</span>
                <div style={{ fontSize: 10, color: "#aaa" }}>{new Date(msg.created_at).toLocaleString()}</div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={sendMessage} style={{ display: "flex", borderTop: "1px solid #eee", padding: 8 }}>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a message..."
            style={{ flex: 1, border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 14 }}
            disabled={loading}
            maxLength={300}
          />
          <button type="submit" disabled={loading || !input.trim()} style={{ marginLeft: 8, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "0 16px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>Send</button>
        </form>
      </div>
    </div>
  );
}
