import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X, Bot, Loader2 } from 'lucide-react';
import { authHeaders } from '../../services/apiAuth';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

const WELCOME: Msg = {
  role: 'assistant',
  text: "Hi, I'm Castimo AI. Ask me anything about connecting your MT5 account, copying, the 50% profit share, paying in USDT or referrals.",
};

const SUGGESTIONS = ['Why is my account not copying?', 'How do I pay my 50% share?', 'Where do I find my TXID?', 'How do referrals work?'];

/**
 * The help assistant: a chat bubble in the bottom-right corner on every page. Answers come from the server (Gemini), which
 * knows the platform's rules and, for a signed-in client, their own account status. Shown only when the server has it on.
 * The conversation lives in this page only and is gone after a reload.
 */
export const AssistantChat: React.FC = () => {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/assistant/status')
      .then((r) => r.json())
      .then((d) => setAvailable(Boolean(d?.available)))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  if (!available) return null;

  const send = async (textRaw?: string) => {
    const text = (textRaw ?? input).trim();
    if (!text || busy) return;
    const next = [...msgs, { role: 'user' as const, text }];
    setMsgs(next);
    setInput('');
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        // The welcome line is ours, not the model's: it is not sent.
        body: JSON.stringify({ messages: next.slice(1).slice(-12) }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.reply) setMsgs((m) => [...m, { role: 'assistant', text: String(d.reply) }]);
      else setError(d?.error || 'The assistant could not answer just now. Please try again.');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Castimo AI help"
          className="fixed z-[60] bottom-20 right-3 left-3 sm:left-auto sm:right-5 sm:w-[380px] max-h-[min(600px,calc(100vh-7rem))] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 dark:text-white">Castimo AI</div>
                <div className="text-[10px] text-slate-500">Help with your account · not financial advice</div>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-md'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {msgs.length === 1 && !busy && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="px-2.5 py-1.5 rounded-full text-[11px] border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
                </div>
              </div>
            )}
            {error && <p className="text-[11px] text-rose-500 px-1">{error}</p>}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-end gap-2 p-3 border-t border-slate-200 dark:border-slate-800"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, 800))}
              onKeyDown={onKey}
              rows={1}
              placeholder="Type your question…"
              className="flex-1 resize-none max-h-28 px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="p-2.5 rounded-xl bg-blue-600 text-white disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <p className="px-3 pb-2 text-[10px] text-slate-400">Never share your passwords here. Answers can be wrong; check important details.</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed z-[60] bottom-4 right-4 sm:bottom-5 sm:right-5 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-xl flex items-center justify-center hover:scale-105 transition"
        aria-label={open ? 'Close the help assistant' : 'Open the help assistant'}
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>
    </>
  );
};
