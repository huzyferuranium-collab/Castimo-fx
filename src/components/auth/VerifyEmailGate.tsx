import React, { useState } from 'react';
import { CheckCircle2, Mail } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

/**
 * Shown in place of the dashboard until the person has confirmed their email address.
 * Everything about verification happens here, together with signing in; none of it appears inside the dashboard.
 */
export const VerifyEmailGate: React.FC = () => {
  const { user, userProfile, sendVerificationEmail, refreshEmailVerified, signOutUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const email = user?.email || userProfile?.email || 'your email';

  const send = async () => {
    setBusy(true);
    setNote(null);
    const r = await sendVerificationEmail();
    setNote(
      r.success
        ? { ok: true, text: 'Link sent. Open the message, tap the link, then come back here. If you do not see it in a minute, check your Spam or Junk folder and mark it "Not spam".' }
        : { ok: false, text: r.error || 'Could not send the email.' }
    );
    setBusy(false);
  };

  const check = async () => {
    setBusy(true);
    setNote(null);
    const ok = await refreshEmailVerified();
    if (!ok) setNote({ ok: false, text: 'Not confirmed yet. Open the link in the email first, then press this button again.' });
    setBusy(false);
  };

  return (
    <div className="max-w-md mx-auto my-10 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
          <Mail className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-bold text-white">Confirm your email</h2>
          <p className="text-xs text-slate-400">One step before you can use your account.</p>
        </div>
      </div>
      <p className="text-xs text-slate-300 leading-relaxed">
        We sent a confirmation link to <strong className="text-white">{email}</strong>. Open it, then press the green button below.
        The message can land in <strong>Spam</strong> or <strong>Junk</strong>, so please look there too.
      </p>
      {note && (
        <div
          className={`p-3 rounded-xl text-xs border flex gap-2 ${
            note.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}
        >
          {note.ok && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span>{note.text}</span>
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={check}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 font-bold text-xs disabled:opacity-50 cursor-pointer"
      >
        I have confirmed my email
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={send}
        className="w-full py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-slate-200 text-xs font-medium disabled:opacity-50 cursor-pointer"
      >
        Send the link again
      </button>
      <button type="button" onClick={signOutUser} className="w-full text-[11px] text-slate-500 hover:text-slate-300 underline cursor-pointer">
        Sign out
      </button>
    </div>
  );
};
