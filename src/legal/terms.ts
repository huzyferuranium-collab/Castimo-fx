/**
 * Terms, Profit-Share Agreement and Risk Disclosure shown to every client before they can use the
 * service. Change TERMS_VERSION whenever the text changes: everyone is then asked to accept again.
 *
 * IMPORTANT: this is a plain-language DRAFT. Have a lawyer in your country review it before launch.
 */
export const TERMS_VERSION = '2026-10-v1';

export interface TermsSection {
  title: string;
  body: string[];
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    title: '1. What CASTIMOFx does',
    body: [
      'CASTIMOFx copies the trades of a master MT5 account onto your own MT5 broker account. Your money stays in your account at your own broker. CASTIMOFx never holds, receives or withdraws your trading funds.',
      'CASTIMOFx is a trade-copying tool. It does not give you personal investment advice and is not a bank, broker or investment fund.',
    ],
  },
  {
    title: '2. Risk warning: you can lose money',
    body: [
      'Trading forex, gold and other leveraged products is risky. You can lose some or all of the money in your account, and with leverage you can lose quickly.',
      'Past results of the master account do not guarantee future results. Nothing on this platform is a promise or guarantee of profit.',
      'Copied trades will not always match the master account. Differences in price, spread, slippage, delays, minimum lot size, margin and your broker\'s rules can cause your results to differ, sometimes by a lot. A trade may fail to copy, copy late, or close at a different price.',
      'Technical problems (internet, servers, MetaApi, your broker, or our systems) can interrupt copying while trades are still open. We cannot promise the service will be uninterrupted or error-free.',
      'Only trade with money you can afford to lose.',
    ],
  },
  {
    title: '3. Your account and login details',
    body: [
      'You confirm you are at least 18 years old, that trading is legal where you live, and that all information you give is true.',
      'To copy trades we need your MT5 account number, server and TRADING password. The password is sent securely to our trade-connection provider (MetaApi) to log in to your broker. Read-only (investor) passwords cannot be used. You can change your MT5 password or disconnect at any time.',
      'You may connect only an account that belongs to you. We may refuse or remove any account we cannot verify with the broker.',
    ],
  },
  {
    title: '4. How copying works',
    body: [
      'Trade sizes are scaled to your account balance compared with the master account, and can be adjusted by the settings we offer. You are responsible for keeping enough margin and balance in your account.',
      'We may pause or stop copying at any time, for example for risk limits, maintenance, an overdue invoice, or if something looks wrong.',
      'If you disconnect or copying stops, trades that are already open stay open on your broker account. They are not closed for you. You must manage them in your MT5.',
    ],
  },
  {
    title: '5. Profit share (our fee)',
    body: [
      'There is no fee for losses. We charge 50% of NEW net profit, measured on your real broker account equity.',
      'We start counting from the equity found when your account is first verified (the "high-water mark"). Money you deposit or withdraw is taken out of the calculation and never counts as profit or loss. We only charge when your equity is above the high-water mark, and losses must be recovered before a new fee is charged.',
      'Every settlement period (currently 7 days) we calculate the fee from your broker\'s figures and issue an invoice in USDT. Fees under 1 USDT are carried to the next invoice.',
      'Because the fee is measured on equity at the settlement time, profit that is later lost again is not refunded.',
      'Pay in USDT on the TRON network (TRC20) to the wallet shown on your invoice. Network fees are paid by you. Send only to the address shown in the app. We never ask you to pay anywhere else.',
      'If an invoice is not paid within the due time (currently 72 hours), copying is paused for your account until it is paid. Unpaid invoices remain owed.',
    ],
  },
  {
    title: '6. Ending the service',
    body: [
      'You can disconnect your account at any time from the dashboard. Invoices already issued remain payable.',
      'We may suspend or end your access if you break these terms, give false information, try to abuse the system, or if we must stop the service. We will try to give notice where possible.',
    ],
  },
  {
    title: '7. Your data',
    body: [
      'We store your sign-in details, the MT5 account number and server you connect, the balance and equity figures reported by your broker, your invoices and payments, and a record that you accepted these terms. Your MT5 password is passed to our connection provider to log in to your broker and is not shown back to you.',
      'We do not sell your personal data.',
    ],
  },
  {
    title: '8. No guarantees, limits on responsibility',
    body: [
      'The service is provided "as is". To the fullest extent the law allows, CASTIMOFx is not responsible for trading losses, missed or delayed trades, broker or third-party failures, or indirect losses. Nothing here limits any right you have under the law that cannot be limited.',
    ],
  },
  {
    title: '9. Changes and law',
    body: [
      'We may update these terms. When we do, we will ask you to accept the new version before you continue.',
      'These terms are governed by the laws of the Republic of Uganda, unless the law where you live gives you stronger protection.',
    ],
  },
];

export const TERMS_CHECKBOXES = [
  'I have read and agree to the Terms and the 50% Profit-Share Agreement.',
  'I understand that trading is risky, that I can lose money, and that nothing is guaranteed.',
];
