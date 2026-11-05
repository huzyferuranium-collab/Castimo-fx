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
4. Deploy, then open `https://<your-service>.onrender.com/api/health`. It should say `UP`. It also shows `version`, the first seven characters of the
   commit that is running (the same one GitHub and Render's Events tab show), so after a push you can tell whether your change is live yet. The start-up
   log line says the same.
5. Run the **Duplikium connection check** again with all four settings in place. It signs in to Duplikium, finds the master
   and the template, and asks for the master's open trades. Every step says what it found. Do this before inviting any client.
6. Firebase console -> Authentication -> Settings -> Authorized domains -> add the onrender.com domain.
7. Publish `firestore.rules` from this repo in the Firebase console.

If a setting is missing the server does not guess: connecting clients is refused with a plain message and nothing is copied.

## Test
Sign in with a real client account and connect one HFM **demo** MT5 login. A wrong password or a fake number must be rejected. A right one shows the
balance the broker reports (Duplikium refreshes balances after each trade and about every five minutes, so a figure can be a few minutes old).
Accounts must be USD. An account below `MIN_CONNECT_EQUITY` (default $200) still connects, but shows "connected, not copying yet" and is held at "close only" at Duplikium until its equity reaches the minimum, when copying starts by itself. Read-only (investor) passwords are refused.

## What the server does with a client
- **Connect:** the client gives login, server and trading password. The password goes to Duplikium to log in; the server keeps only Duplikium's
  account id, the login and the server (Firestore `mt5_accounts/{userId}`), never the password. The account is added from your Duplikium template, exactly as
  "Add Slave" does it in the cockpit, so it copies as the template says as soon as Duplikium has logged in. No copy setting is changed for an ordinary client.
  Once the login is confirmed and balances are read, our rules only ever **hold copying back** (paused, unpaid, or below the minimum equity); if that cannot be set
  at once the client still connects and the periodic check keeps trying. Keep the template's copy status **on**: the server then needs no extra call.
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

**How fast a client connects.** The client's account is added from the template, exactly like *Add Slave* in the cockpit; Duplikium then logs in by itself and
starts copying. Our site only has to *see* that the login worked, and that takes reads of Duplikium's account list. Duplikium allows few of those when few accounts
are linked (per linked account: 2 a minute and 30 an hour), so the server spends them carefully: one read is shared by everybody (the Master card, every dashboard,
every client connecting), a connect uses about 2-3 reads, dashboards use none, and an administrator's page reuses a list read in the last 15 seconds.
Every new connection is written to the Render log as `Connected #... - took N s (account added after N s, N status reads)`, which shows the real speed.
More linked accounts means a larger allowance; asking Duplikium to raise the limit is the other way to speed things up.

Optional settings (defaults in brackets):
- `DUPLIKIUM_REFRESH_SECONDS` [60] how often the server reads accounts from Duplikium.
- `DUPLIKIUM_RISK_TYPE` / `DUPLIKIUM_RISK_VALUE` copy size given to every new client; if unset the template's own is used.
- `MIN_CONNECT_EQUITY` [200], `CONNECT_SYNC_WAIT_SECONDS` [120], `CONNECT_PROBE_MS` [5000], `CONNECT_FIRST_PROBE_MS` [6000], `CONNECT_KEEP_READS` [3], `CONNECT_DISCONNECT_GRACE_MS` [45000],
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

## Security built into the server
- **Browser security headers** (`src/backend/securityHeaders.ts`): no content-type guessing, the site cannot be shown inside another site's frame, other sites see only our address as referrer,
  camera/microphone/location/payment sheet are switched off, and (production) HTTPS is remembered for 180 days. `public/_headers` only works on Cloudflare Pages, so these come from the server.
  A Content-Security-Policy is deliberately not set yet: it can break Firebase sign-in and fonts unless it is tested against the live site first.
- **Request limits** (`src/backend/rateLimit.ts`, counted per visitor address, in memory, so a restart clears them): 600 requests a minute for all of `/api`; 60 changes (anything that is not a plain read) per 10 minutes
  on `/api/trade` and on `/api/referrals`; 30 per 10 minutes for email codes. Over the limit the server answers "Too many requests" with a wait time. These stop floods and guessing; for real attack traffic put Cloudflare in front.
  - `TRUST_PROXY_HOPS` (default `1`, correct for Render alone) = how many proxies sit in front of the server. **Set it to `2` if you put Cloudflare in front**, otherwise every visitor looks like one of Cloudflare's addresses and shares one limit.
  - `RATE_LIMIT_OFF=1` switches every limit off at once (emergency only), no code change needed.
- **Master account details are private**: `GET /api/trade/account-status` needs a signed-in user. Clients receive the connection state and the master's balance, equity and open-trade count; only an administrator also
  receives the master's account number, broker server and Duplikium id.

## Payments wallet
Add `VITE_TREASURY_ADDRESS` = your real TRON (TRC20) USDT address in Render's environment variables, then redeploy.
Until it is set, the site shows "Payment address not set yet" and refuses payments, so nobody can send money to a wrong address.

## The two plans never mix
- **Monthly ($100 / 30 days):** the client sends USDT (TRC20) to the treasury address and pastes the TXID on the Service Plan page. Once verified, copying runs for the month and
  nothing is taken from their profit: no ledger, no invoices, no 50% screens. If the month ends unpaid, copying pauses until they pay again.
- **50% profit share:** no upfront fee; invoices are created from real profit and are due before midnight GMT (23:59) on the day they are made. Unpaid after that, copying pauses until paid. An hourly watcher writes reminders to the client's notifications during the last 6 hours. Reminders at 6, 3 and 1 hours before the due time, and one when copying pauses, are also emailed to the client's confirmed address (needs `RESEND_API_KEY` and `EMAIL_FROM`; an unconfirmed address gets none).
The rule lives in `billingStanding()` (`src/backend/servicePlan.ts`, tested) and is used by the sweep, by switching copying on, and by connecting.

## Turning on real profit-share billing
Billing creates invoices from each client's real closed-trade profit and checks USDT payments on the TRON blockchain.
It stays OFF until both of these are set on Render (Environment):

1. `TREASURY_ADDRESS` = your real TRON (TRC20) USDT address (use the same value as `VITE_TREASURY_ADDRESS`).
2. `FIREBASE_SERVICE_ACCOUNT` = the full contents of a Firebase service-account key (JSON):
   - Firebase console -> Project settings (gear) -> Service accounts -> **Generate new private key**.
   - Open the downloaded file, copy ALL of its text, and paste it as the value. Never put this file in GitHub.

Optional settings (defaults in brackets):
- `FEE_PCT` [50] share of new profit.
- `SETTLEMENT_PERIOD_DAYS` [1] how often, in days, profit is settled and invoices can be made (every 24 hours by default).
- `MIN_INVOICE_PROFIT_USD` [20] new profit needed before an invoice is made; smaller profit is carried forward and copying is not paused for it.
- `TRONGRID_API_KEY` free key from trongrid.io, recommended to avoid rate limits.

How it works: profit is the net result (profit + commission + swap) of the trades that **closed** on the client's account, read from the copier service.
Because a closed trade is never affected by money moving in or out of the account, deposits and withdrawals can never count as profit, and the copier
service does not need to report them.
- The first time a client's broker account is verified, a ledger starts. Only trades that closed after that moment are ever counted.
- Every closed trade is stored once (Firestore `ps_days`), so repeating a check can never count it twice.
- At each period end (`SETTLEMENT_PERIOD_DAYS`, every 24 hours by default) the cumulative closed-trade result is compared with its high-water mark. 50% of the part above the mark
  becomes an invoice once that new profit reaches `MIN_INVOICE_PROFIT_USD` ($20 by default); below that, or when the fee would be under $1, it rolls into the next period.
  After a loss, profit must first climb back above the mark. Open (floating) trades are not charged until they close.
- If any closed trade has no readable profit or close time, that client is NOT billed or updated until it can be read (the Render log says which client and why). Nothing is guessed.
- Clients that were connected before this was switched on are billed on trades closed since they connected, but their first invoice waits 2 days after this version first runs, so you can compare the first daily updates with Duplikium before anything is invoiced.
- **Daily update:** from 00:15 GMT each day, every profit-share client gets a "Profit Share update" in their notifications (Firestore `ps_daily`): what closed the day before,
  the period so far, and their 50% share so far. Nothing is written for a day whose trades could not be read.
- Only USD accounts are billed automatically. The new collections are server-only; the existing "everything else is refused" rule already covers them, so no rules change is needed.

Check it with the first real client (after the Duplikium API is enabled): after 00:15 GMT open Render -> Logs and look for "NOT billed or updated" (it lists the reason); in Firebase -> Firestore open
`ps_days` and `ps_daily` and compare the trades and totals with the client's closed trades in the Duplikium dashboard. Not yet confirmed against a live Duplikium account: the exact fields of its closed-positions
answer (profit, commission, swap, close time) and whether it lists only trades the copier made. Until you have compared one client, treat the first invoice as a draft and check it before the client pays.
