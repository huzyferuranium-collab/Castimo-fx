import React, { useState } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { AlertTriangle, Power, RefreshCw, CheckCircle2, ShieldAlert } from 'lucide-react';

interface Mt5DisconnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

export const Mt5DisconnectModal: React.FC<Mt5DisconnectModalProps> = ({
  isOpen,
  onClose,
  userId,
}) => {
  const [step, setStep] = useState<'confirm' | 'processing' | 'done'>('confirm');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDisconnect = async () => {
    setErrorMsg(null);
    setStep('processing');
    setStatusMessage('Dispatching idempotent disconnect command...');

    const result = await tradingEngine.requestMt5Disconnection(userId, (msg) => {
      setStatusMessage(msg);
    });

    if (result.success) {
      setStep('done');
      setTimeout(() => {
        setStep('confirm');
        onClose();
      }, 1800);
    } else {
      setErrorMsg(result.error || 'Disconnection failed.');
      setStep('confirm');
    }
  };

  const openTradesCount = tradingEngine.getOpenTrades().length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-rose-600/20 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <Power className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Disconnect MT5 Copier</h3>
              <p className="text-xs text-slate-400">Safe shutdown state machine (Section 11)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={step === 'processing'}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          {step === 'confirm' && (
            <>
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-xs text-rose-300">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>CRITICAL DISCONNECTION WARNING</span>
                </div>
                <p className="text-xs leading-relaxed">
                  Disconnecting will <strong>stop new trade copying</strong> and automatically <strong>liquidate/close all {openTradesCount} open copied trades</strong> at prevailing market rates.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <div className="font-semibold text-slate-300">State Machine Progression:</div>
                <div className="font-mono text-emerald-400 text-xs">
                  copying → disconnect_requested → closing_positions → disconnected
                </div>
                <p className="text-[10px] text-slate-500 pt-1">
                  Idempotent execution prevents double triggers. Audit log is updated with closure confirmations.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 text-xs rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300">
                  {errorMsg}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-1/2 py-2.5 px-3 rounded-xl border border-slate-800 text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
                >
                  Cancel / Keep Active
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="w-1/2 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 font-semibold text-xs text-white shadow-md shadow-rose-600/30 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>Confirm Disconnect</span>
                </button>
              </div>
            </>
          )}

          {step === 'processing' && (
            <div className="p-6 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-400">
                <RefreshCw className="w-7 h-7 animate-spin" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-white">Executing Safe Disconnection</h4>
                <p className="text-xs font-mono text-emerald-400 mt-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
                  {statusMessage}
                </p>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="p-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h4 className="font-bold text-base text-white">Disconnected Safely</h4>
              <p className="text-xs text-slate-400">
                All open positions closed. Copier bridge terminated. Audit trail logged in database.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
