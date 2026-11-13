/**
 * CASTIMOFX - Institutional Full-Stack Application Server
 * 
 * Express HTTP server providing:
 * - Trade API routes (/api/trade/*)
 * - MT5 connection manager for the Duplikium copier service (Duplikium does the copying)
 * - Vite dev middlewares (development) & static file serving (production)
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { tradeRouter } from './src/backend/WEBHOOK_ROUTES';
import { referralRouter } from './src/backend/REFERRAL_ROUTES';
import { emailCodeRouter } from './src/backend/EMAIL_CODE_ROUTES';
import { assistantRouter } from './src/backend/ASSISTANT_ROUTES';
import { Mt5ConnectionManager } from './src/backend/MT5_CONNECTION_MANAGER';
import { BillingService, billingEnabled } from './src/backend/billing';
import { createJobsRouter, cronSecret, usesExternalScheduler } from './src/backend/scheduledJobs';
import { buildAssetLinks } from './src/backend/assetLinks';
import { securityHeaders } from './src/backend/securityHeaders';
import { rateLimit, trustProxyHops, isReadOnly } from './src/backend/rateLimit';
import { saveClientRecord, loadSavedStatus, loadSavedLowFunds, verifiedTerminalLookup } from './src/backend/clientStore';
import { getDoc, isFirestoreAdminConfigured } from './src/backend/firestoreAdmin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

// A stray rejection or exception is logged and must not take the whole server down.
process.on('unhandledRejection', (reason: any) => {
  console.warn('⚠️ [SERVER] Handled unhandled rejection:', reason);
});

process.on('uncaughtException', (err: any) => {
  console.error('❌ [SERVER] Uncaught exception:', err);
});

async function startServer() {
  const app = express();

  // Settles once the MT5 connections are restored and billing has started (below, after the server starts listening).
  let markReady!: () => void;
  let markFailed!: (e: unknown) => void;
  const serverReady = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  serverReady.catch(() => undefined); // a failed start-up is reported by the job that waits for it
  const externalScheduler = usesExternalScheduler();

  // Do not announce which software runs the server, and add the browser security headers to every answer.
  app.disable('x-powered-by');
  app.use(securityHeaders({ production: isProduction }));

  // Render puts one proxy in front of the server (TRUST_PROXY_HOPS=2 if Cloudflare is added too). This makes
  // req.ip the visitor's real address, which the request limits below count by.
  app.set('trust proxy', trustProxyHops(process.env));

  // Request limits, checked before any body is read. The general one is generous (phones share addresses on mobile
  // networks and the dashboards refresh often); the stricter ones cover only things a person does now and then.
  const TEN_MINUTES = 10 * 60_000;
  app.use('/api', rateLimit({ max: 600, windowMs: 60_000 }));
  app.use('/api/trade', rateLimit({ max: 60, windowMs: TEN_MINUTES, skip: isReadOnly }));
  app.use('/api/referrals', rateLimit({ max: 60, windowMs: TEN_MINUTES, skip: isReadOnly }));
  app.use('/api/email-code', rateLimit({ max: 30, windowMs: TEN_MINUTES, skip: isReadOnly }));

  // Middleware for body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount Trade & Webhook API routes
  app.use('/api/trade', tradeRouter);
  app.use('/api/referrals', referralRouter);
  app.use('/api/email-code', emailCodeRouter);
  app.use('/api/assistant', assistantRouter);

  // On a host that sleeps between visits (Cloud Run), Cloud Scheduler runs billing here instead of the server's own timers.
  if (externalScheduler) {
    const secret = cronSecret();
    if (!secret) console.error('❌ [SERVER] SCHEDULED_JOBS=external but CRON_SECRET is missing or shorter than 24 characters: billing will not run.');
    const billing = BillingService.getInstance();
    app.use(
      '/api/internal/jobs',
      createJobsRouter({
        secret,
        ready: () => serverReady,
        jobs: { sweep: () => billing.runScheduledJob('sweep'), reminders: () => billing.runScheduledJob('reminders') },
      })
    );
  }

  // Which build is running (Render sets RENDER_GIT_COMMIT; the Cloud Run build sets APP_VERSION). Opening /api/health shows it,
  // so "is my latest change live?" can be checked.
  const version = (process.env.RENDER_GIT_COMMIT || process.env.APP_VERSION || '').slice(0, 7) || 'unknown';

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'UP',
      service: 'CASTIMOFX_MT5_CORE',
      version,
      timestamp: new Date().toISOString(),
    });
  });

  // Lets the Android app (Google Play) prove it belongs to this website. Served only when both Render settings are valid.
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const links = buildAssetLinks(process.env);
    if (!links) return res.status(404).json({ error: 'Not configured' });
    res.type('application/json').set('Cache-Control', 'public, max-age=300').send(JSON.stringify(links));
  });

  // Any /api address that no route above answered is a mistake: say so with a 404, instead of letting the website
  // fallback below answer it with the home page (status 200).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (isProduction) {
    const missing = ['DUPLIKIUM_API_USER', 'DUPLIKIUM_API_TOKEN', 'DUPLIKIUM_MASTER_ID', 'DUPLIKIUM_TEMPLATE_ID'].filter((k) => !(process.env[k] || '').trim());
    if (missing.length) {
      console.error(`❌ [SERVER] ${missing.join(', ')} not set. Broker verification is OFF: no client account can be connected until they are set.`);
    }
  }

  // Vite middleware in dev or static files in production
  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('⚡ [SERVER] Vite development middleware mounted.');
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Application build not found. Run npm run build.');
      }
    });
    console.log('📦 [SERVER] Serving static production build from /dist.');
  }

  // Start HTTP server immediately so pre-warming check and UI are accessible without waiting on cloud RPC
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [SERVER] CASTIMOFx Server (version ${version}) listening on http://0.0.0.0:${PORT}`);

    // Asynchronously bootstrap the MT5 connection manager and billing in the background
    void (async () => {
      try {
        console.log('🔌 [SERVER] Bootstrapping the MT5 connection manager (Duplikium) in background...');
        const connectionManager = Mt5ConnectionManager.getInstance();
        connectionManager.onClientSaved = (rec) => void saveClientRecord(rec).catch((e) => console.warn('[STORE] save failed:', e?.message));
        connectionManager.loadSavedStatus = loadSavedStatus;
        connectionManager.loadSavedLowFunds = loadSavedLowFunds;
        if (isFirestoreAdminConfigured()) {
          connectionManager.wasVerified = verifiedTerminalLookup((uid) => getDoc('mt5_accounts', uid));
        } else {
          console.warn('⚠️ [SERVER] FIREBASE_SERVICE_ACCOUNT is not set: connected accounts cannot be remembered across restarts.');
        }
        // With billing on, nobody's payment standing is known until the first billing check: do not switch an unpaid client's copying back on at start-up.
        connectionManager.holdCopyingUntilBillingKnown = billingEnabled();
        await connectionManager.initialize();

        BillingService.getInstance().start({ timers: !externalScheduler });
        console.log('✅ [SERVER] CastimoFX connection manager initialized.');
        markReady();
      } catch (err: any) {
        console.warn('⚠️ [SERVER] Background MT5 connection manager initialization deferred:', err?.message || err);
        markFailed(err);
      }
    })();
  });
}

startServer().catch((error) => {
  console.error('❌ [SERVER] Fatal startup error:', error);
  process.exit(1);
});
