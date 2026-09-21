import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Personal control-plane auth: shared API key in Authorization: Bearer …
 * No Clerk / Google / Replit auth needed for a single-owner phone app.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CONTROL_API_KEY?.trim();
  if (!expected) {
    res.status(500).json({ error: "CONTROL_API_KEY is not configured on the API server." });
    return;
  }

  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const provided = match?.[1]?.trim() ?? "";
  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
