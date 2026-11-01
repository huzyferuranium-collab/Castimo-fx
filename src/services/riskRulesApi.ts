import { authHeaders } from './apiAuth';

/** The risk rules the server really applies, as read from where they are set. Read-only. */
export interface RiskRules {
  /** The equity a NEW client needs to connect. Checked once, at connection. `source` says whether it was set on Render or is the built-in default. */
  connectMinimum: { usd: number; source: 'setting' | 'default' };
  /** The copy size every new client gets (Duplikium's own type and value). Null when it cannot be read right now. */
  copySize: { type: number; value: number; source: 'setting' | 'template' } | null;
}

/** Administrators only. Returns null when the rules cannot be read, so the page shows nothing rather than a guess. */
export async function getRiskRules(): Promise<RiskRules | null> {
  try {
    const res = await fetch('/api/trade/admin/risk-rules', { headers: await authHeaders() });
    if (!res.ok) return null;
    const d = await res.json();
    const m = d?.connectMinimum;
    if (!d?.success || !m || !Number.isFinite(m.usd)) return null;
    const c = d.copySize;
    const copySize = c && Number.isFinite(c.type) && Number.isFinite(c.value) ? { type: c.type, value: c.value, source: c.source === 'setting' ? ('setting' as const) : ('template' as const) } : null;
    return { connectMinimum: { usd: m.usd, source: m.source === 'setting' ? 'setting' : 'default' }, copySize };
  } catch {
    return null;
  }
}
