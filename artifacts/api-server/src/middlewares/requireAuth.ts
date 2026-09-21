import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);

  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
