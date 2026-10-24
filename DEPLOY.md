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
