"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, X } from "lucide-react";

type Msg = { role: "you" | "bot"; text: string; sources?: { title: string }[]; outcome?: string };
const KEY = "weft-assistant-conversation";

export default function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conv = useRef<string | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { try { conv.current = sessionStorage.getItem(KEY) ?? undefined; } catch { /* sem armazenamento: tudo bem */ } }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [msgs, busy]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [open]);

  async function send() {
    const message = text.trim();
    if (!message || busy) return;
    setText(""); setError(""); setBusy(true);
    setMsgs((m) => [...m, { role: "you", text: message }]);
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, conversationId: conv.current }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.message === "string" ? j.message : "Something went wrong.");
      conv.current = j.conversationId;
      try { sessionStorage.setItem(KEY, j.conversationId); } catch { /* ignore */ }
      setMsgs((m) => [...m, ...(j.disclosure ? [{ role: "bot" as const, text: j.disclosure, outcome: "disclosure" }] : []), { role: "bot", text: j.reply.text, sources: j.reply.sources, outcome: j.reply.outcome }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setBusy(false); input.current?.focus(); }
  }

  if (!open) {
    return (
      <button className="asst-fab" onClick={() => setOpen(true)} aria-label="Ask about a part, an order or our policies">
        <Bot className="icon l" aria-hidden /> Ask us
      </button>
    );
  }
  return (
    <div className="asst-panel" role="complementary" aria-label="Part assistant">
      <div className="h"><Bot className="icon" aria-hidden /><b>Ask about parts, orders and policies</b><small>AI assistant</small>
        <button className="btn" style={{ marginLeft: 8, height: 30, padding: "0 8px" }} onClick={() => setOpen(false)} aria-label="Close assistant"><X className="icon s" aria-hidden /></button></div>
      <div className="b" aria-live="polite">
        {msgs.length === 0 && <div className="bot">Hi, I'm an AI assistant for Halden Moto Parts. Ask me about returns, delivery, fitment, a part's price and stock, or your order. A person can take over any time.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "you" ? "you" : "bot"}>
            {m.text}
            {m.sources && m.sources.length > 0 && <small>Source: {[...new Set(m.sources.map((s) => s.title))].join(" · ")}</small>}
            {m.outcome === "handoff" && <small>A person will follow up.</small>}
          </div>
        ))}
        {busy && <div className="bot" aria-busy="true">Checking…</div>}
        {error && <div className="bot err" role="alert">{error}</div>}
        <div ref={end} />
      </div>
      <form className="asst-in" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Type your question" aria-label="Your question" />
        <button className="cta" style={{ height: 40, flex: "none", padding: "0 14px" }} disabled={busy || !text.trim()} aria-label="Send"><Send className="icon s" aria-hidden /></button>
      </form>
      <div className="note">I'm an AI assistant and can make mistakes. For safety parts, confirm with a person. Prices and stock are read live, never from memory.</div>
    </div>
  );
}
