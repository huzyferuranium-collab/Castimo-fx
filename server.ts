/**
 * CASTIMOFX - Institutional Full-Stack Application Server
 * 
 * Express HTTP server providing:
 * - Trade API routes (/api/trade/*)
 * - MetaApi MT5 Connection Manager & High-Frequency Replication Engine
 * - Vite dev middlewares (development) & static file serving (production)
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { tradeRouter } from './src/backend/WEBHOOK_ROUTES';
import { phoneRouter } from './src/backend/PHONE_ROUTES';
import { Mt5ConnectionManager } from './src/backend/MT5_CONNECTION_MANAGER';
import { ReplicationEngine } from './src/backend/REPLICATION_ENGINE';
import { BillingService } from './src/backend/billing';
import { saveClientRecord, loadSavedStatus } from './src/backend/clientStore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

function isTransientSocketError(err: any): boolean {
  if (!err) return false;
  const str = `${err?.name || ''} ${err?.message || ''} ${err?.type || ''} ${err?.description || ''} ${String(err)}`.toLowerCase();
  return (
    str.includes('xhr post error') ||
    str.includes('restorerejecterror') ||
    str.includes('socket does not have mapped wrapper') ||
    str.includes('transporterror') ||
    str.includes('websocket client closed') ||
    str.includes('cannot restore connection session') ||
    str.includes('connection lost')
  );
}

// Prevent transient WebSocket/XHR socket reconnection hiccups from crashing Node
process.on('unhandledRejection', (reason: any) => {
  if (isTransientSocketError(reason)) {
    console.log('ℹ️ [SOCKET_SUPERVISOR] MetaApi cloud socket recovery event handled gracefully.');
    return;
  }
  console.warn('⚠️ [SERVER] Handled unhandled rejection:', reason);
});

process.on('uncaughtException', (err: any) => {
  if (isTransientSocketError(err)) {
    console.log('ℹ️ [SOCKET_SUPERVISOR] Transient socket exception handled gracefully.');
    return;
  }
  console.error('❌ [SERVER] Uncaught exception:', err);
});

async function startServer() {
  const app = express();

  // Middleware for body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount Trade & Webhook API routes
  app.use('/api/trade', tradeRouter);
  app.use('/api/phone', phoneRouter);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'UP',
      service: 'CASTIMOFX_MT5_CORE',
      timestamp: new Date().toISOString(),
    });
  });

  if (isProduction && !process.env.METAAPI_TOKEN) {
    console.error('❌ [SERVER] METAAPI_TOKEN is not set. Broker verification is OFF: no client account can be connected until it is set.');
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

    // Asynchronously bootstrap MT5 Connection Manager, Replication Engine, and Billing in background
    void (async () => {
      try {
        console.log('🔌 [SERVER] Bootstrapping MT5 Connection Manager & Replication Engine in background...');
        const connectionManager = Mt5ConnectionManager.getInstance();
        connectionManager.onClientSaved = (rec) => void saveClientRecord(rec).catch((e) => console.warn('[STORE] save failed:', e?.message));
        connectionManager.loadSavedStatus = loadSavedStatus;
        await connectionManager.initialize();

        const replicationEngine = ReplicationEngine.getInstance();
        replicationEngine.attachToMasterStream();
        BillingService.getInstance().start();
        console.log('✅ [SERVER] CastimoFX MT5 Replication Engine initialized and listening.');
      } catch (err: any) {
        console.warn('⚠️ [SERVER] Background MT5 Connection Manager initialization deferred:', err?.message || err);
      }
    })();
  });
}

startServer().catch((error) => {
  console.error('❌ [SERVER] Fatal startup error:', error);
  process.exit(1);
});
