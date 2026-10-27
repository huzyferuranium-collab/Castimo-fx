# Hosting the verifying server (Render, step by step)

Cloudflare only serves web pages. The broker check runs in `server.ts`, which needs a Node host.
This repo has a Dockerfile, so any Docker host works (Render, Railway, Google Cloud Run).

## Render
1. render.com -> New -> Web Service -> connect `huzyferuranium-collab/Castimo-fx`, branch `main`.
2. Runtime: Docker. Instance type: the smallest paid one (free sleeps and drops broker connections).
3. Environment variables:
   - `METAAPI_TOKEN`  = your MetaApi token (app.metaapi.cloud)
   - `MASTER_ACCOUNT_ID` = MetaApi account id of YOUR master HFM account
   - `PORT` is set by Render automatically.
   - Do NOT set `ALLOW_SIMULATED_TRADES`.
4. Deploy, then open `https://<your-service>.onrender.com/api/health`. It should say `UP`.
5. Firebase console -> Authentication -> Settings -> Authorized domains -> add the onrender.com domain.
6. Publish `firestore.rules` from this repo in the Firebase console.

## Test
Sign in with a real account, connect one HFM **demo** MT5 login. A wrong password or fake number
must be rejected. A right one shows the balance the broker reports.
Your HFM account must be a hedging account; netting accounts are not supported by MetaApi.

## Cost limits (MetaApi charges per account)
Set these on Render next to `METAAPI_TOKEN`:
- `MAX_CLIENT_ACCOUNTS` = most client accounts allowed in total (default 5, `0` = no limit). Set it to what your MetaApi plan includes.
- `MAX_ACCOUNTS_PER_USER` = accounts per client (default 1).
Clients who disconnect are removed from MetaApi, which stops their charge. Admins can see usage at `/api/trade/capacity`.

## How client terminals are looked after (terminal supervisor)
Connecting a client's MT5 account no longer depends on the browser staying open. As soon as a client's terminal exists in
MetaApi the server remembers it (Firestore `client_connections/{userId}`, no passwords) and a background supervisor moves it forward:
- starts a terminal that MetaApi left undeployed, and restarts one that stays "deployed but disconnected" (what pressing Redeploy in MetaApi does);
- reads the account from the broker when the terminal connects, applies the usual rules and puts the client into service;
- if a brand-new terminal never connects within 15 minutes it is removed and the client is told kindly (and can simply press Connect again);
- a client who was verified before (or has billing history) is never given up on or cleaned up automatically: their terminal is restarted patiently, and no minimum-equity check is repeated;
- after every deploy or restart, unfinished connections and existing client terminals are picked up again by themselves;
- a connected client whose link stays down for a while gets their terminal restarted gently.

The client sees a calm "your terminal is connecting" notice on the dashboard instead of an error, and it turns into the normal connected view by itself.
Admin console -> **Client Terminals** lists every client terminal as MetaApi sees it (state, broker link, restarts, time left) with Restart / Remove buttons
and "Clean up leftovers" (the master is never listed; clients in service cannot be removed there; a terminal of a client verified before needs a second confirmation).
**Connection Log** shows how long each connecting step took, so a slow broker or region is easy to spot.
Optional settings are in `.env.example` (`CONNECT_MAX_PARALLEL`, `SUPERVISOR_MAX_PARALLEL`, the three `CONNECT_*_WAIT_SECONDS`).

## Payments wallet
Add `VITE_TREASURY_ADDRESS` = your real TRON (TRC20) USDT address in Render's environment variables, then redeploy.
Until it is set, the site shows "Payment address not set yet" and refuses payments, so nobody can send money to a wrong address.

## Turning on real profit-share billing
Billing creates invoices from each client's real broker profit and checks USDT payments on the TRON blockchain.
It stays OFF until both of these are set on Render (Environment):

1. `TREASURY_ADDRESS` = your real TRON (TRC20) USDT address (use the same value as `VITE_TREASURY_ADDRESS`).
2. `FIREBASE_SERVICE_ACCOUNT` = the full contents of a Firebase service-account key (JSON):
   - Firebase console -> Project settings (gear) -> Service accounts -> **Generate new private key**.
   - Open the downloaded file, copy ALL of its text, and paste it as the value. Never put this file in GitHub.

Optional settings (defaults in brackets):
- `FEE_PCT` [50] share of new profit.
- `SETTLEMENT_PERIOD_DAYS` [7] how often invoices are made.
- `INVOICE_DUE_HOURS` [72] time to pay before copying pauses.
- `TRONGRID_API_KEY` free key from trongrid.io, recommended to avoid rate limits.

How it works: the first time a client's broker account is verified, their equity becomes the starting
high-water mark. Deposits and withdrawals are read from the broker and never count as profit or loss.
At each period end, 50% of profit above the high-water mark becomes an invoice (invoices under $1 roll into the next one).
Only USD accounts are billed automatically. Publish the updated `firestore.rules` too.
