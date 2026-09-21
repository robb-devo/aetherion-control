import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Router, type IRouter } from "express";
import { requireAuth, requirePermission } from "../middlewares/requireAuth";

const router: IRouter = Router();

const REPO = process.env.GITHUB_REPO?.trim() || "robb-devo/aetherion-control";
const downloadTickets = new Map<string, { url: string; expiresAt: number }>();

type GhRelease = {
  tag_name?: string;
  body?: string;
  html_url?: string;
  assets?: Array<{ name?: string; browser_download_url?: string; url?: string; size?: number }>;
};

function githubToken() {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";
}

async function fetchLatestRelease(): Promise<{
  tag: string;
  version: string;
  notes: string;
  assetApiUrl: string;
  assetName: string;
  size: number;
  pageUrl: string;
} | null> {
  const token = githubToken();
  if (!token) return null;
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "AETHERION-Control-API",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub releases failed (HTTP ${response.status})`);
  }
  const data = (await response.json()) as GhRelease;
  const tag = data.tag_name ?? "";
  const version = tag.replace(/^v/i, "");
  const apk = (data.assets ?? []).find((asset) => /\.apk$/i.test(asset.name ?? ""));
  if (!version || !apk?.url) return null;
  return {
    tag,
    version,
    notes: (data.body ?? "").trim().slice(0, 400),
    assetApiUrl: apk.url,
    assetName: apk.name ?? "aetherion.apk",
    size: typeof apk.size === "number" && apk.size > 0 ? apk.size : 0,
    pageUrl: data.html_url ?? `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`,
  };
}

// Ticket creation requires CONTROL_API_KEY (same auth as the rest of the app).
router.get("/app/latest", requireAuth, requirePermission("app.update"), async (req, res) => {
  try {
    const latest = await fetchLatestRelease();
    if (!latest) {
      res.status(503).json({
        error: githubToken()
          ? "No APK asset found on the latest GitHub release."
          : "GITHUB_TOKEN is not configured on the API server.",
      });
      return;
    }
    const ticket = randomBytes(24).toString("hex");
    downloadTickets.set(ticket, {
      url: latest.assetApiUrl,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    const host = req.get("host") ?? "135.181.18.162:5055";
    const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "http";
    res.json({
      tag: latest.tag,
      version: latest.version,
      notes: latest.notes,
      apkName: latest.assetName,
      size: latest.size,
      pageUrl: latest.pageUrl,
      // Short-lived URL — phone can open it without a Bearer header.
      apkUrl: `${proto}://${host}/api/app/apk?t=${ticket}`,
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Update check failed" });
  }
});

// Public by one-time ticket (created after authenticated /latest).
router.get("/app/apk", async (req, res) => {
  const ticket = typeof req.query.t === "string" ? req.query.t : "";
  const entry = downloadTickets.get(ticket);
  if (!entry || entry.expiresAt < Date.now()) {
    downloadTickets.delete(ticket);
    res.status(401).json({ error: "Download link expired. Check for updates again." });
    return;
  }
  try {
    const token = githubToken();
    const upstream = await fetch(entry.url, {
      headers: {
        Accept: "application/octet-stream",
        Authorization: `Bearer ${token}`,
        "User-Agent": "AETHERION-Control-API",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "follow",
    });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: `GitHub asset download failed (HTTP ${upstream.status})` });
      return;
    }
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", 'attachment; filename="AETHERION-Control.apk"');
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    Readable.fromWeb(upstream.body as NodeWebReadableStream).pipe(res);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "APK proxy failed" });
  }
});

export default router;
