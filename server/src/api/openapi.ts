import { readFileSync } from 'node:fs';
import type { Request, Response } from 'express';

const candidates = [
  new URL('../../openapi.json', import.meta.url),
  new URL('../openapi.json', import.meta.url),
];

let cached: string | null = null;

function spec(): string {
  if (cached) return cached;
  for (const path of candidates) {
    try {
      cached = readFileSync(path, 'utf8');
      return cached;
    } catch {
      // Try the next build layout.
    }
  }
  throw new Error('OpenAPI document is missing from the server build.');
}

/** Public, unauthenticated contract copy. */
export function openApiHandler(_req: Request, res: Response): void {
  try {
    res
      .type('application/json')
      .setHeader('Cache-Control', 'public, max-age=300')
      .send(spec());
  } catch {
    res.status(500).json({ error: 'internal', message: 'OpenAPI document unavailable.' });
  }
}
