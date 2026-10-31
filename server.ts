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
import { Mt5ConnectionManager } from './src/backend/MT5_CONNECTION_MANAGER';
import { BillingService } from './src/backend/billing';
import { saveClientRecord, loadSavedStatus, verifiedTerminalLookup } from './src/backend/clientStore';
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

  // Middleware for body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount Trade & Webhook API routes
  app.use('/api/trade', tradeRouter);
  app.use('/api/referrals', referralRouter);
  app.use('/api/email-code', emailCodeRouter);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'UP',
      service: 'CASTIMOFX_MT5_CORE',
      timestamp: new Date().toISOString(),
    });
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
    console.log(`🚀 [SERVER] CASTIMOFx Server listening on http://0.0.0.0:${PORT}`);

    // Asynchronously bootstrap the MT5 connection manager and billing in the background
    void (async () => {
      try {
        console.log('🔌 [SERVER] Bootstrapping the MT5 connection manager (Duplikium) in background...');
        const connectionManager = Mt5ConnectionManager.getInstance();
        connectionManager.onClientSaved = (rec) => void saveClientRecord(rec).catch((e) => console.warn('[STORE] save failed:', e?.message));
        connectionManager.loadSavedStatus = loadSavedStatus;
        if (isFirestoreAdminConfigured()) {
          connectionManager.wasVerified = verifiedTerminalLookup((uid) => getDoc('mt5_accounts', uid));
        } else {
          console.warn('⚠️ [SERVER] FIREBASE_SERVICE_ACCOUNT is not set: connected accounts cannot be remembered across restarts.');
        }
        await connectionManager.initialize();

        BillingService.getInstance().start();
        console.log('✅ [SERVER] CastimoFX connection manager initialized.');
      } catch (err: any) {
        console.warn('⚠️ [SERVER] Background MT5 connection manager initialization deferred:', err?.message || err);
      }
    })();
  });
}

startServer().catch((error) => {
  console.error('❌ [SERVER] Fatal startup error:', error);
  process.exit(1);
});
