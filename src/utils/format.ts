import { REFERRAL_RATES_PCT } from '../backend/referrals';

/** "$1,234.50": a money amount in US dollars (USDT is shown the same way). */
export const formatUsd = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Wed, 04 Nov, 07:30 GMT": a moment in GMT, the only clock the platform uses for billing and payouts. */
export const formatGmt = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' GMT';

/** The three referral rates from the one place they are set, for example "10% / 5% / 5%". */
export const referralRatesLabel = (separator = ' / '): string => REFERRAL_RATES_PCT.map((r) => `${r}%`).join(separator);
