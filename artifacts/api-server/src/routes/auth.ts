import { Router, type IRouter } from "express";
import { getSession, requireAuth, revokeSession, unlockWithCode } from "../lib/accessCodes";

const router: IRouter = Router();

/**
 * Public unlock: friends only enter an access code.
 * Returns a session token the app stores instead of CONTROL_API_KEY.
 */
router.post("/auth/unlock", (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  try {
    const session = unlockWithCode(code);
    res.json({
      token: session.token,
      displayName: session.name,
      role: session.role,
      permissions: session.permissions,
    });
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : "Unlock failed" });
  }
});

router.get("/auth/me", requireAuth, (req, res) => {
  const access = req.access;
  if (!access) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({
    displayName: access.name,
    role: access.role,
    permissions: access.permissions,
    code: "code" in access ? access.code : undefined,
  });
});

router.post("/auth/logout", requireAuth, (req, res) => {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim() ?? "";
  if (token.startsWith("aes_") && getSession(token)) {
    revokeSession(token);
  }
  res.json({ ok: true });
});

export default router;
