import cookieParser from "cookie-parser";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { SandboxError } from "../lib/sandbox";
import { installAddon, listAddons, removeAddon } from "../lib/webAddons";
import {
  AccountError,
  RateLimiter,
  SESSION_TTL_MS,
  authenticate,
  createSession,
  publicUser,
  registerUser,
  revokeSession,
  scopeForWebUser,
  userForSession,
  type WebUser,
} from "../lib/webAccounts";
import {
  createWebServer,
  deleteWebServer,
  getWebServer,
  listWebServers,
  networkStatus,
  restartWebServer,
  startWebServer,
  stopWebServer,
  updateWebServer,
  webOptions,
  webServerCommand,
  webServerConsole,
} from "../lib/webServers";

/**
 * Public website API, served to https://donnernet.de through nginx at /api/web.
 * Sessions are HttpOnly cookies; state-changing requests must come from the
 * site itself (custom header + Origin allow-list), which blocks CSRF.
 */

const router: IRouter = Router();
const SESSION_COOKIE = "aeth_session";

const loginByIp = new RateLimiter(20, 15 * 60_000);
const loginByName = new RateLimiter(8, 15 * 60_000);
const registerByIp = new RateLimiter(5, 60 * 60_000);
const createByUser = new RateLimiter(12, 60 * 60_000);
const actionByUser = new RateLimiter(40, 60_000);

function allowedOrigins() {
  return (process.env.WEB_ALLOWED_ORIGINS || "https://donnernet.de,https://www.donnernet.de")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.WEB_COOKIE_INSECURE !== "1",
    sameSite: "lax" as const,
    path: "/api/web",
    maxAge: SESSION_TTL_MS,
  };
}

function sameSiteGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const origin = req.header("origin");
  if (req.header("x-aetherion-web") !== "1" || (origin && !allowedOrigins().includes(origin))) {
    res.status(403).json({ error: "Request blocked.", code: "FORBIDDEN" });
    return;
  }
  next();
}

function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = userForSession(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Please sign in.", code: "UNAUTHORIZED" });
    return;
  }
  res.locals.user = user;
  next();
}

function currentUser(res: Response) {
  return res.locals.user as WebUser;
}

function limited(res: Response, retryAfterSec: number) {
  res.setHeader("Retry-After", String(retryAfterSec));
  res.status(429).json({
    error: "Too many attempts. Try again in a few minutes.",
    code: "RATE_LIMITED",
    details: { retryAfterSec },
  });
}

function throttleActions(req: Request, res: Response, next: NextFunction) {
  const verdict = actionByUser.take(currentUser(res).id);
  if (!verdict.allowed) {
    limited(res, verdict.retryAfterSec);
    return;
  }
  next();
}

function sendError(req: Request, res: Response, error: unknown) {
  if (error instanceof SandboxError || error instanceof AccountError) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error instanceof SandboxError && error.details ? { details: error.details } : {}),
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) {
    res.status(404).json({ error: "Server not found.", code: "NOT_FOUND" });
  } else if (/not enough sandbox/i.test(message)) {
    res.status(409).json({ error: message, code: "POOL_FULL" });
  } else if (/must be|required|exists|unsupported|not available|invalid/i.test(message)) {
    res.status(400).json({ error: message, code: "VALIDATION" });
  } else {
    req.log?.error({ err: error }, "web api upstream failure");
    res.status(502).json({ error: "The server host did not answer. Try again in a moment.", code: "UPSTREAM" });
  }
}

function handle(task: (req: Request, res: Response) => Promise<unknown>, status = 200) {
  return async (req: Request, res: Response) => {
    try {
      const body = await task(req, res);
      res.status(status).json(body);
    } catch (error) {
      sendError(req, res, error);
    }
  };
}

function signIn(res: Response, user: WebUser) {
  res.cookie(SESSION_COOKIE, createSession(user.id), cookieOptions());
  return { user: publicUser(user) };
}

router.use("/web", cookieParser(), sameSiteGuard, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get(
  "/web/network",
  handle(async () => networkStatus()),
);

router.get(
  "/web/options",
  handle(async () => webOptions()),
);

router.post("/web/auth/register", async (req, res) => {
  const verdict = registerByIp.take(req.ip ?? "unknown");
  if (!verdict.allowed) {
    limited(res, verdict.retryAfterSec);
    return;
  }
  try {
    const user = await registerUser(req.body?.username, req.body?.password);
    res.status(201).json(signIn(res, user));
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/web/auth/login", async (req, res) => {
  const nameKey = String(req.body?.username ?? "").trim().toLowerCase();
  const byIp = loginByIp.take(req.ip ?? "unknown");
  const byName = loginByName.take(nameKey);
  if (!byIp.allowed || !byName.allowed) {
    limited(res, Math.max(byIp.retryAfterSec, byName.retryAfterSec));
    return;
  }
  try {
    const user = await authenticate(req.body?.username, req.body?.password);
    loginByName.reset(nameKey);
    res.json(signIn(res, user));
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/web/auth/logout", (req, res) => {
  revokeSession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

router.get("/web/auth/me", requireUser, (_req, res) => {
  res.json({ user: publicUser(currentUser(res)) });
});

router.get(
  "/web/servers",
  requireUser,
  handle(async (_req, res) => listWebServers(scopeForWebUser(currentUser(res)))),
);

router.post("/web/servers", requireUser, async (req, res) => {
  const verdict = createByUser.take(currentUser(res).id);
  if (!verdict.allowed) {
    limited(res, verdict.retryAfterSec);
    return;
  }
  try {
    res.status(201).json(await createWebServer(req.body ?? {}, scopeForWebUser(currentUser(res))));
  } catch (error) {
    sendError(req, res, error);
  }
});

router.get(
  "/web/servers/:id",
  requireUser,
  handle(async (req, res) => getWebServer(String(req.params.id), scopeForWebUser(currentUser(res)))),
);

router.patch(
  "/web/servers/:id",
  requireUser,
  throttleActions,
  handle(async (req, res) => updateWebServer(String(req.params.id), scopeForWebUser(currentUser(res)), req.body ?? {})),
);

router.delete(
  "/web/servers/:id",
  requireUser,
  throttleActions,
  handle(async (req, res) => deleteWebServer(String(req.params.id), scopeForWebUser(currentUser(res)))),
);

const lifecycle = { start: startWebServer, stop: stopWebServer, restart: restartWebServer } as const;

for (const [action, run] of Object.entries(lifecycle)) {
  router.post(
    `/web/servers/:id/${action}`,
    requireUser,
    throttleActions,
    handle(async (req, res) => run(String(req.params.id), scopeForWebUser(currentUser(res)))),
  );
}

router.get(
  "/web/servers/:id/addons",
  requireUser,
  handle(async (req, res) => listAddons(String(req.params.id), scopeForWebUser(currentUser(res)))),
);

router.post(
  "/web/servers/:id/addons",
  requireUser,
  throttleActions,
  handle(async (req, res) => installAddon(String(req.params.id), scopeForWebUser(currentUser(res)), req.body?.versionId), 201),
);

router.delete(
  "/web/servers/:id/addons/:file",
  requireUser,
  throttleActions,
  handle(async (req, res) => removeAddon(String(req.params.id), scopeForWebUser(currentUser(res)), req.params.file)),
);

router.get(
  "/web/servers/:id/console",
  requireUser,
  handle(async (req, res) =>
    webServerConsole(String(req.params.id), scopeForWebUser(currentUser(res)), Number(req.query.lines ?? 250)),
  ),
);

router.post(
  "/web/servers/:id/console",
  requireUser,
  throttleActions,
  handle(async (req, res) => webServerCommand(String(req.params.id), scopeForWebUser(currentUser(res)), req.body?.command)),
);

export default router;
