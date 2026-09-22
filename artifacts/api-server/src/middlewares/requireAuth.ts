import type { NextFunction, Request, Response } from "express";
import {
  classifyBearer,
  hasPermission,
  launcherServiceKey,
  type AccessPrincipal,
} from "../lib/bearerAuth.mjs";

export { hasPermission, launcherServiceKey };
export type { AccessPrincipal };

declare global {
  namespace Express {
    interface Request {
      access?: AccessPrincipal;
    }
  }
}

/**
 * Accepts the phone CONTROL_API_KEY (owner) or the desktop launcher friend key.
 * The friend key is LAUNCHER_SERVICE with permission `sandbox` only, and it is
 * accepted even when CONTROL_API_KEY is not configured.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const provided = match?.[1]?.trim() ?? "";
  const result = classifyBearer(provided);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  req.access = result.access;
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasPermission(req.access, permission)) {
      res.status(403).json({ error: `Missing permission: ${permission}` });
      return;
    }
    next();
  };
}
