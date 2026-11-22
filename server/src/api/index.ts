/**
 * /api/v1 router.
 *
 * Public only for the OpenAPI document. Everything else requires the sync
 * passphrase as a bearer token. Browser origins are denied unless explicitly
 * configured in API_CORS_ORIGINS; n8n calls server-to-server.
 */

import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { entitiesByKind, openSpace } from '../space/store.js';
import type { Routine } from '../trainer/types.js';
import { apiAuth, type ApiRequest } from './auth.js';
import { exercisesHandler } from './catalogue.js';
import { contextHandler } from './context.js';
import { apiRoute, sendApiError } from './errors.js';
import { muscleVolumeHandler, prsHandler } from './metrics.js';
import { openApiHandler } from './openapi.js';
import { listSessionsHandler, putSessionHandler } from './sessions.js';

const apiOrigins = (process.env.API_CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const allowed = Boolean(origin && apiOrigins.includes(origin));

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(allowed ? 204 : 403);
    return;
  }

  if (origin && !allowed) {
    res.status(403).json({ error: 'origin_not_allowed', message: 'This browser origin is not allowed.' });
    return;
  }

  next();
}

export const apiRouter = Router();

const knownPaths = new Set([
  '/openapi.json',
  '/context',
  '/routines',
  '/exercises',
  '/sessions',
  '/prs',
  '/muscles/volume',
]);

apiRouter.use(cors);
apiRouter.use((req, res, next) => {
  if (knownPaths.has(req.path) || /^\/sessions\/[^/]+$/.test(req.path)) {
    next();
    return;
  }
  res.status(404).json({ error: 'not_found', message: 'Unknown API route.' });
});
apiRouter.get('/openapi.json', openApiHandler);
apiRouter.use(apiAuth);
apiRouter.use(express.json({ limit: '256kb' }));

apiRouter.get('/context', apiRoute(contextHandler));
apiRouter.get('/routines', apiRoute(async (req, res) => {
  const { user, keys } = (req as ApiRequest).apiAuth;
  const routines = entitiesByKind<Routine>(await openSpace(user, keys), 'routine').sort(
    (a, b) => Number(b.active) - Number(a.active) || b.updatedAt.localeCompare(a.updatedAt),
  );
  res.json({ routines });
}));
apiRouter.get('/exercises', apiRoute(exercisesHandler));
apiRouter.get('/sessions', apiRoute(listSessionsHandler));
apiRouter.put('/sessions/:date', apiRoute(putSessionHandler));
apiRouter.get('/prs', apiRoute(prsHandler));
apiRouter.get('/muscles/volume', apiRoute(muscleVolumeHandler));

apiRouter.use((_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Unknown API route.' });
});

apiRouter.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  sendApiError(res, error);
});
