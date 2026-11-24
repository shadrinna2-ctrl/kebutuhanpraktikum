import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from './server/db.ts';
import {
  csrfOriginGuard,
  resolveSessionMiddleware,
  sqliTelemetryMiddleware,
} from './server/middleware.ts';
import authRoutes from './server/routes/auth.ts';
import accountRoutes from './server/routes/account.ts';
import catalogRoutes from './server/routes/catalog.ts';
import adminRoutes from './server/routes/admin.ts';
import superadminRoutes from './server/routes/superadmin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createServerApp() {
  await initializeDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers (iframe-compatible for AI Studio preview)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  app.use(express.json({ limit: '512kb' }));

  // Malformed JSON error handler (never expose parser internals)
  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Format JSON tidak valid.' });
      return;
    }
    next(err);
  });

  app.use('/api', csrfOriginGuard);
  app.use('/api', resolveSessionMiddleware);
  app.use('/api', sqliTelemetryMiddleware);

  app.use('/api/auth', authRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/superadmin', superadminRoutes);

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  });

  // Never serve database files over HTTP
  app.use('/data', (_req: Request, res: Response) => {
    res.status(403).json({ error: 'Akses ditolak.' });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const imagesDir = path.join(__dirname, 'src', 'assets', 'images');
    if (fs.existsSync(imagesDir)) {
      app.use('/src/assets/images', express.static(imagesDir, { maxAge: '7d' }));
    }
    const distDir = path.join(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.use((_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  // Global error handler — never expose SQL errors, stack traces, or table/column names
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[ServerError]', err instanceof Error ? err.message : 'unknown');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Terjadi kesalahan internal. Silakan coba beberapa saat lagi.' });
    }
  });

  return app;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  const port = Number(process.env.PORT) || 3000;
  createServerApp()
    .then((app) => {
      app.listen(port, '0.0.0.0', () => {
        console.log(`PinjamAlat secure server listening on http://0.0.0.0:${port}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
