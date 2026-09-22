const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const { URL } = require("node:url");
const { spawnSync } = require("node:child_process");
const extract = require("extract-zip");
const { paths, ensureDir } = require("./paths.cjs");

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "http:" ? http : https;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "AetherionLauncher/1.0",
          ...(options.headers || {}),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(request(res.headers.location, options));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        resolve(res);
      },
    );
    req.on("error", reject);
  });
}

async function downloadFile(url, dest, onProgress) {
  ensureDir(path.dirname(dest));
  const tmp = `${dest}.part`;
  const res = await request(url);
  const total = Number(res.headers["content-length"] || 0);
  let received = 0;

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.on("data", (chunk) => {
      received += chunk.length;
      if (onProgress && total > 0) {
        onProgress(received / total);
      }
    });
    res.pipe(out);
    out.on("finish", () => out.close(resolve));
    out.on("error", reject);
    res.on("error", reject);
  });

  fs.renameSync(tmp, dest);
}

function findJavaBinary(javaHome) {
  const candidates = [
    path.join(javaHome, "bin", "javaw.exe"),
    path.join(javaHome, "bin", "java.exe"),
    path.join(javaHome, "jre", "bin", "javaw.exe"),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function probeJavaVersion(javaBin) {
  const result = spawnSync(javaBin, ["-version"], { encoding: "utf8" });
  const text = `${result.stderr || ""}${result.stdout || ""}`;
  const match = text.match(/version\s+"(\d+)(?:\.\d+)?/);
  if (!match) return null;
  return Number(match[1]);
}

function findSystemJava(major) {
  const envCandidates = [process.env.JAVA_HOME, process.env.JDK_HOME].filter(Boolean);
  for (const home of envCandidates) {
    const bin = findJavaBinary(home);
    if (!bin) continue;
    const version = probeJavaVersion(bin);
    if (version && version >= major) return bin;
  }

  const pathBins = ["javaw", "java"];
  for (const name of pathBins) {
    const result = spawnSync(name, ["-version"], { encoding: "utf8", shell: true });
    if (result.error) continue;
    const text = `${result.stderr || ""}${result.stdout || ""}`;
    const match = text.match(/version\s+"(\d+)(?:\.\d+)?/);
    if (match && Number(match[1]) >= major) {
      // Prefer absolute path if possible
      const where = spawnSync("where", [name], { encoding: "utf8", shell: true });
      const first = (where.stdout || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      return first || name;
    }
  }
  return null;
}

async function ensureJava(major, emit) {
  const p = paths();
  const bundled = findJavaBinary(p.javaHome);
  if (bundled) {
    const version = probeJavaVersion(bundled);
    if (version && version >= major) {
      emit?.({ phase: "java", message: `Using bundled Java ${version}`, progress: 1 });
      return bundled;
    }
  }

  const system = findSystemJava(major);
  if (system) {
    emit?.({ phase: "java", message: `Using system Java`, progress: 1 });
    return system;
  }

  emit?.({ phase: "java", message: "Downloading Java 21…", progress: 0 });
  const zipPath = path.join(p.runtime, "temurin-21.zip");
  const extractTo = path.join(p.runtime, "temurin-extract");
  if (fs.existsSync(extractTo)) fs.rmSync(extractTo, { recursive: true, force: true });
  ensureDir(extractTo);

  const url =
    "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk";

  await downloadFile(url, zipPath, (ratio) => {
    emit?.({ phase: "java", message: "Downloading Java 21…", progress: ratio * 0.85 });
  });

  emit?.({ phase: "java", message: "Extracting Java…", progress: 0.9 });
  await extract(zipPath, { dir: extractTo });

  const children = fs.readdirSync(extractTo).map((name) => path.join(extractTo, name));
  const jreDir = children.find((c) => fs.statSync(c).isDirectory());
  if (!jreDir) throw new Error("Java archive did not contain a JRE folder");

  if (fs.existsSync(p.javaHome)) fs.rmSync(p.javaHome, { recursive: true, force: true });
  fs.renameSync(jreDir, p.javaHome);
  fs.rmSync(extractTo, { recursive: true, force: true });
  try {
    fs.unlinkSync(zipPath);
  } catch {
    /* ignore */
  }

  const bin = findJavaBinary(p.javaHome);
  if (!bin) throw new Error("Java install succeeded but javaw.exe was not found");
  emit?.({ phase: "java", message: "Java 21 ready", progress: 1 });
  return bin;
}

module.exports = {
  ensureJava,
  downloadFile,
  request,
};
