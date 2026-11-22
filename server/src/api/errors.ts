import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** An error that maps directly onto the API error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new ApiError(status, code, message, details);
}

/** Express 4 does not catch rejected async handlers; route them to the error middleware. */
export function apiRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export function sendApiError(res: Response, error: unknown): void {
  if (res.headersSent) return;

  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
    return;
  }

  // Body-parser errors (malformed JSON, 256 KB limit) carry a 4xx status.
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({
      error: status === 413 ? 'body_too_large' : 'invalid_body',
      message: status === 413 ? 'Request body is too large.' : 'Malformed request body.',
    });
    return;
  }

  res.status(500).json({ error: 'internal', message: 'Internal server error.' });
}
