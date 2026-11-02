# Hosting the verifying server (Render, step by step)

Cloudflare only serves web pages. The broker check and the copier control run in `server.ts`, which needs a Node host.
This repo has a Dockerfile, so any Docker host works (Render, Railway, Google Cloud Run).

CASTIMOFx uses **Duplikium** (trade-copier.com) to copy trades. Duplikium logs in to each client's MT5 account and copies the master
account's trades onto it. This server connects clients to Duplikium, switches copying on or off to match each client's plan and payments,
and reads balances and trades back for the dashboards.

Duplikium's API may need their Trade Copier API add-on (their documentation says it is free from 10 paid accounts). Confirm with Duplikium before relying on it.

## One-time setup at Duplikium
1. Add your master HFM account (261089492, server HFMarketsGlobal-Live20) in the Duplikium dashboard as a **master**.
2. Create one **default slave template** there with the copy size you want every client to get. The server reads the template's copy size and gives the same to
   each new client (or use `DUPLIKIUM_RISK_TYPE` / `DUPLIKIUM_RISK_VALUE` below to set it from Render instead).
3. You need the master's account id and the template's id. After setting `DUPLIKIUM_API_USER` and `DUPLIKIUM_API_TOKEN` on Render, open Admin console ->
   **Duplikium Accounts** -> **Duplikium connection check**: it lists your accounts (with their ids) and the templates in use, so you can copy the right ids into
   `DUPLIKIUM_MASTER_ID` and `DUPLIKIUM_TEMPLATE_ID`. A template that no account uses yet is not visible that way: put one account on it first, or ask Duplikium support.
4. Ask Duplikium support, in writing: how many client accounts one cockpit may hold, whether there is an account limit or per-account price,
   and how they store and protect the MT5 passwords clients give.

## Render
1. render.com -> New -> Web Service -> connect `huzyferuranium-collab/Castimo-fx`, branch `main`.
2. Runtime: Docker. Instance type: the smallest paid one (free sleeps and drops connections).
3. Environment variables:
   - `DUPLIKIUM_API_USER`   = the login of your Duplikium cockpit (the API user)
   - `DUPLIKIUM_API_TOKEN`  = the API password for that user (a secret: only ever type it into Render, never into chat or GitHub)
   - `DUPLIKIUM_MASTER_ID`  = the Duplikium id of your master account
   - `DUPLIKIUM_TEMPLATE_ID` = the Duplikium id of the default slave template
   - `PORT` is set by Render automatically.
4. Deploy, then open `https://<your-service>.onrender.com/api/health`. It should say `UP`.
5. Run the **Duplikium connection check** again with all four settings in place. It signs in to Duplikium, finds the master
   and the template, and asks for the master's open trades. Every step says what it found. Do this before inviting any client.
6. Firebase console -> Authentication -> Settings -> Authorized domains -> add the onrender.com domain.
7. Publish `firestore.rules` from this repo in the Firebase console.

If a setting is missing the server does not guess: connecting clients is refused with a plain message and nothing is copied.

## Test
Sign in with a real client account and connect one HFM **demo** MT5 login. A wrong password or a fake number must be rejected. A right one shows the
balance the broker reports (Duplikium refreshes balances after each trade and about every five minutes, so a figure can be a few minutes old).
Accounts must be USD with at least `MIN_CONNECT_EQUITY` (default $200). Read-only (investor) passwords are refused.

## What the server does with a client
- **Connect:** the client gives login, server and trading password. The password goes to Duplikium to log in; the server keeps only Duplikium's
  account id, the login and the server (Firestore `mt5_accounts/{userId}`), never the password. The new account starts with copying **frozen**; it is switched
  on only after the broker login is confirmed, balances are read and the account passes the checks.
- **Pause / resume:** a client who pauses, or whose plan is unpaid or expired, is set to **close only**: no new trades are copied, and trades already
  open are still closed when the master closes them. Switching copying on again sets it back to on. After a restart the server checks every account against what it should be.
- **Disconnect:** the account is removed from Duplikium. Trades that are already open stay open in the client's own MT5 account; nothing is closed for them.
- **Dashboards:** balance, equity and free margin come from Duplikium. Open and closed trades are read from Duplikium; a price, stop or target Duplikium did not
  report is shown as a dash, never made up. Leverage and the account holder's name are not reported by Duplikium and are not shown.
- **Castimo AI panel:** shows the master account's real open trades, or says plainly that they are unavailable.

## Limits (Duplikium may charge per account)
Set these on Render next to the Duplikium settings:
- `MAX_CLIENT_ACCOUNTS` = most client accounts allowed in total (default `0` = no limit). Set it to what your Duplikium plan includes.
- `MAX_ACCOUNTS_PER_USER` = accounts per client (default 1).
Admins can see usage at `/api/trade/capacity` and in Admin console -> **Duplikium Accounts**, where a leftover or stuck account can be removed.
A client who is in service (or has billing history) needs a second confirmation before their account can be removed there.

Optional settings (defaults in brackets):
- `DUPLIKIUM_REFRESH_SECONDS` [60] how often the server reads accounts from Duplikium.
- `DUPLIKIUM_RISK_TYPE` / `DUPLIKIUM_RISK_VALUE` copy size given to every new client; if unset the template's own is used.
- `MIN_CONNECT_EQUITY` [200], `CONNECT_SYNC_WAIT_SECONDS` [120], `CONNECT_PROBE_MS` [4000], `CONNECT_DISCONNECT_GRACE_MS` [45000],
  `CONNECT_BACKGROUND_MINUTES` [20], `CONNECT_MAX_PARALLEL` [3]. A slow broker is not a failure: when the browser's wait is over the connection keeps going in the
  background and the dashboard updates by itself.
- `MASTER_LOGIN` / `MASTER_SERVER` an extra guard so the master account can never be added as a client.

## Moving from MetaApi
MetaApi is gone from the code. `METAAPI_TOKEN`, `MASTER_ACCOUNT_ID` and the other MetaApi settings are no longer read; remove them from Render.
Clients connected before the change must connect again (their old MetaApi account ids mean nothing to Duplikium). Existing profit-share records,
plans and invoices are untouched.

## Audit log
Audit-log addresses are the address the server saw for that person's own session.

## Email confirmation codes (optional)
Besides the verification link, people can get a 6-digit code by email (random, valid 10 minutes, 5 tries, only a salted hash is stored).
Turn it on by setting on Render: `RESEND_API_KEY` (from resend.com) and `EMAIL_FROM` (an address on a domain you have verified there, e.g. `CASTIMOFX <noreply@castimofx.com>`).
The server needs `FIREBASE_SERVICE_ACCOUNT` too, and that service account must be allowed to edit Firebase Authentication users (the default Firebase Admin one is).
Until both are set, the code option is simply not shown and the link keeps working. Publish the updated `firestore.rules` as well.

## Install on a phone, and the Android app (Google Play)
The site is installable: it has a web app manifest (`public/manifest.webmanifest`), icons (`public/icons`), and a tiny service worker (`public/sw.js`) whose
only job is to show `public/offline.html` when the connection drops. It deliberately caches nothing else, so balances, invoices and payments are always live.
Phones then offer "Install app" / "Add to Home Screen" in the browser menu.

To publish it on Google Play as an Android app (a Trusted Web Activity that opens castimofx.com full screen):
1. Create the package at pwabuilder.com from `https://castimofx.com` (Android package). Note the package name you choose, e.g. `com.castimofx.app`.
2. In Render set `ANDROID_PACKAGE_NAME` (that package name) and `ANDROID_SHA256_FINGERPRINTS` (the SHA-256 certificate fingerprint(s), written `AB:CD:...`, 32 pairs;
   several can be separated by commas or new lines: the app-signing key from Google Play Console -> Setup -> App signing, plus the PWABuilder/test key if you test with it).
3. The server then serves `/.well-known/assetlinks.json` itself. Until both settings are valid it answers "not found", so nothing wrong is ever served.
4. Google Play still needs: a developer account (new personal accounts must run a closed test with 12 testers for 14 days first), a privacy policy link, the Data safety form,
   the Financial features declaration, an in-app way to delete an account, and a review of Google's Payments policy for USDT payments.

## Payments wallet
Add `VITE_TREASURY_ADDRESS` = your real TRON (TRC20) USDT address in Render's environment variables, then redeploy.
Until it is set, the site shows "Payment address not set yet" and refuses payments, so nobody can send money to a wrong address.

## The two plans never mix
- **Monthly ($100 / 30 days):** the client sends USDT (TRC20) to the treasury address and pastes the TXID on the Service Plan page. Once verified, copying runs for the month and
  nothing is taken from their profit: no ledger, no invoices, no 50% screens. If the month ends unpaid, copying pauses until they pay again.
- **50% profit share:** no upfront fee; invoices are created from real profit and are due within 24 hours. Unpaid after that, copying pauses until paid.
The rule lives in `billingStanding()` (`src/backend/servicePlan.ts`, tested) and is used by the sweep, by switching copying on, and by connecting.

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
- `INVOICE_DUE_HOURS` [24] time to pay an invoice before copying pauses (50% profit-share clients only).
- `TRONGRID_API_KEY` free key from trongrid.io, recommended to avoid rate limits.

How it works: the first time a client's broker account is verified, their equity becomes the starting
high-water mark. Deposits and withdrawals are read from the broker and never count as profit or loss.
At each period end, 50% of profit above the high-water mark becomes an invoice (invoices under $1 roll into the next one).
Only USD accounts are billed automatically. Publish the updated `firestore.rules` too.
