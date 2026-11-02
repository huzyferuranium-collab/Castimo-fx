/**
 * The notification a client sees about an account that is connected but not (yet) copying because it is below the
 * minimum equity, and the one that follows when copying starts. Built from what the server saved for the account
 * (`mt5_accounts/{userId}`), so it is only ever about something that really happened.
 */

export interface CopyNotice {
  id: string;
  title: string;
  message: string;
  at: string;
}

const NOTICE_DAYS = 14;

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function copyNoticeFor(doc: Record<string, unknown> | null | undefined, now: number = Date.now()): CopyNotice | null {
  if (!doc) return null;
  const min = typeof doc.copyMinimumUsd === 'number' && Number.isFinite(doc.copyMinimumUsd) ? doc.copyMinimumUsd : null;
  const minText = min === null ? 'the minimum' : usd(min);

  if (doc.copyHeld === 'LOW_FUNDS') {
    const at = String(doc.copyHeldSince || doc.updatedAt || '');
    if (!at) return null;
    return {
      id: `held-${at}`,
      title: 'Connected, not copying yet',
      message: `Your account is connected. Trades start copying as soon as your account equity reaches ${minText}. Add funds at your broker whenever you are ready: there is nothing else to do, we start by ourselves.`,
      at,
    };
  }

  const started = doc.copyStartedAt ? String(doc.copyStartedAt) : '';
  if (started && now - Date.parse(started) < NOTICE_DAYS * 86_400_000) {
    return {
      id: `started-${started}`,
      title: 'Copying has started',
      message: `Your account now has ${minText}, so trades from the master account are being copied to it.`,
      at: started,
    };
  }
  return null;
}
