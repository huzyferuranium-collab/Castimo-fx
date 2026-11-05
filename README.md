# Castimofx

An MT5 trade-copier platform. Clients connect their own MetaTrader 5 account, and the trades of a master account are copied onto it through
[Duplikium](https://trade-copier.com). Client funds stay with the client's own broker; the platform never holds deposits.

Clients choose one of two plans, paid in USDT (TRC20):

- **Monthly plan**: a flat $100 for 30 days.
- **Profit share**: nothing upfront; 50% of new closed-trade profit, invoiced from the client's real results with a high-water mark.

A three-level **Referral Hub** pays referrers 10% / 5% / 5% of a referred client's first Monthly Plan payment, plus 3% / 2% / 1% of every
referred client's equity once a week.

## Features

- **Client terminal**: connect an MT5 account (login, server, trading password), see balance, equity, open and closed trades, pause or resume copying.
- **Copier control**: accounts are added to Duplikium from a default slave template. Copying is held back (set to "close only") when a client pauses,
  is unpaid, or is below the minimum equity, and switched back on by itself when that changes.
- **Billing**: Monthly Plan payments verified by TXID on the TRON blockchain; daily profit-share settlement with invoices due before 23:59 GMT,
  reminders in the app and by email.
- **Referral Hub**: referral links, earnings across three levels, and withdrawal requests to a TRON address (minimum 50 USDT, 10% fee, paid weekly).
- **Admin console**: master account status, connected terminals, Duplikium connection check, income, withdrawals and a connection log.
- **Castimo AI assistant**: a help chat bubble backed by Google Gemini.
- **Email confirmation codes** through Resend (optional).
- **Installable web app** (PWA) that can also be published to Google Play as an Android app.
- **Security**: browser security headers, per-visitor request limits, and Firebase sign-in checked on every protected API call.

## Tech stack

| Part | Technology |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4, Motion, lucide-react |
| Server | Node 22, Express 4, run with `tsx` (`server.ts`) |
| Auth and data | Firebase Authentication and Firestore |
| Trade copying | Duplikium (trade-copier.com) API |
| Payments | USDT on TRON (TRC20), checked through TronGrid |
| AI assistant | Google Gemini (`@google/genai`) |
| Email | Resend |
| Tests | Node's built-in test runner (`node --test`) |

## Getting started

Requirements: Node.js 22 and npm.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

The server listens on <http://localhost:3000> (set `PORT` to change it). In development it serves the React app through Vite's middleware, so
the website and the API run from the same process. Check it with <http://localhost:3000/api/health>, which should answer `"status": "UP"`.

Without any settings the app still runs: the website loads, but clients cannot connect accounts, billing is off, and the server logs a warning
for each missing piece.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm start` | Start the server (`tsx server.ts`). Development mode unless `NODE_ENV=production`. |
| `npm run build` | Build the website into `dist/`. |
| `npm run lint` | Type-check the whole project (`tsc --noEmit`). |
| `npm test` | Run the tests in `tests/`. |
| `npm run preview` | Preview the built website with Vite (no API). |
| `npm run clean` | Delete `dist/`. |
| `npm run deploy:cloudflare` | Build and publish the static website to Cloudflare Pages. |

To run the production build locally:

```bash
npm run build
```

```bash
NODE_ENV=production npm start
```

## Configuration

All settings are environment variables. `.env.example` lists every one with a description; these are the main ones.

| Variable | Needed for |
|---|---|
| `DUPLIKIUM_API_USER`, `DUPLIKIUM_API_TOKEN` | Connecting to Duplikium. Without them no client account can be connected. |
| `DUPLIKIUM_MASTER_ID`, `DUPLIKIUM_TEMPLATE_ID` | The master account and the default slave template new clients are added from. |
| `FIREBASE_SERVICE_ACCOUNT` | Server access to Firestore (the full service-account JSON). Needed for billing and for remembering accounts across restarts. |
| `TREASURY_ADDRESS` | The server's copy of your USDT (TRC20) address. Billing stays off until this and `FIREBASE_SERVICE_ACCOUNT` are set. |
| `VITE_TREASURY_ADDRESS` | The same address, built into the website. Payments are refused until it is set. Set it before `npm run build`. |
| `GEMINI_API_KEY` | Turns on the AI assistant. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email confirmation codes and invoice reminder emails (optional). |
| `TRUST_PROXY_HOPS` | Proxies in front of the server: `1` for Render alone, `2` behind Cloudflare too. |
| `MIN_CONNECT_EQUITY` | Equity an account needs before trades are copied (default 200). |
| `MAX_CLIENT_ACCOUNTS`, `MAX_ACCOUNTS_PER_USER` | Account limits, to match your Duplikium plan. |
| `FEE_PCT`, `SETTLEMENT_PERIOD_DAYS`, `MIN_INVOICE_PROFIT_USD` | Profit-share settings (defaults 50%, every 1 day, $20). |

Never commit real secrets. `.env*` files are ignored by git, except `.env.example`.

## Project structure

```
server.ts              Express server: API routes, security, Vite (dev) or dist/ (production)
src/
  App.tsx, main.tsx    React entry points
  components/          UI, grouped by area (landing, dashboard, admin, mt5, referrals, payments, ...)
  backend/             Server-side code: Duplikium client, connection manager, billing, profit share,
                       referrals, email codes, assistant, rate limits, security headers
  services/            Browser-side API clients and helpers
  hooks/, context/     React hooks and theme context
  config/firebase.ts   Firebase web setup
  legal/terms.ts       Terms of service text
tests/                 Unit tests for the backend and services
public/                Static files: PWA manifest, icons, service worker, offline page
firestore.rules        Firestore security rules (publish them in the Firebase console)
Dockerfile             One container that builds the website and runs the server
wrangler.toml          Cloudflare Pages settings (static website only)
DEPLOY.md              Step-by-step hosting and setup guide
```

### API

| Path | Purpose |
|---|---|
| `GET /api/health` | Health check; shows the running commit as `version`. |
| `/api/trade/*` | Account connection, copier status, trades, capacity. |
| `/api/referrals/*` | Referral Hub and withdrawals. |
| `/api/email-code/*` | Email confirmation codes. |
| `/api/assistant/*` | AI assistant. |
| `GET /.well-known/assetlinks.json` | Android app link file (only when the Android settings are set). |

## Deployment

The website can be served as static files (for example Cloudflare Pages), but broker verification, copier control and billing run in `server.ts` and
need a Node host. The included `Dockerfile` works on Render, Railway or Google Cloud Run.

[DEPLOY.md](DEPLOY.md) has the full guide: Duplikium setup, Render, Firebase, payments, billing, email codes, security and the Android app.
