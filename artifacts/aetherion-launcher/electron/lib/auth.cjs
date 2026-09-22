const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");
const { Auth } = require("msmc");
const { paths, readJson, writeJson } = require("./paths.cjs");

function loginWindowOptions() {
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
  return {
    width: 520,
    height: 700,
    title: "Sign in — AETHERION",
    backgroundColor: "#0B0E12",
    parent: parent || undefined,
    modal: Boolean(parent),
    skipTaskbar: true,
    icon: path.join(__dirname, "..", "..", "assets", "icon.png"),
  };
}

function publicAccount(profile) {
  if (!profile?.name) return null;
  return {
    name: profile.name,
    id: profile.id || "",
    avatar: profile.id ? `https://mc-heads.net/avatar/${profile.id}/64` : null,
  };
}

function loadStored() {
  return readJson(paths().account, null);
}

function clearAccount() {
  const file = paths().account;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * @returns {Promise<{ account: object, mclc: object } | null>}
 */
async function restoreSession() {
  const stored = loadStored();
  if (!stored) return null;

  try {
    const auth = new Auth("select_account");

    // Preferred: xbox refresh token string from xbox.save()
    if (typeof stored.xboxRefresh === "string" && stored.xboxRefresh.length > 0) {
      const xbox = await auth.refresh(stored.xboxRefresh);
      const token = await xbox.getMinecraft();
      writeJson(paths().account, {
        xboxRefresh: xbox.save(),
        profile: token.profile,
      });
      return {
        account: publicAccount(token.profile),
        mclc: token.mclc(true),
      };
    }

    // Fallback: mclc-shaped token with embedded refresh
    if (stored.mclc?.meta?.refresh) {
      const { tokenUtils } = require("msmc");
      const mc = await tokenUtils.fromMclcToken(auth, stored.mclc, true);
      if (!mc) {
        clearAccount();
        return null;
      }
      writeJson(paths().account, {
        xboxRefresh: stored.xboxRefresh || null,
        profile: mc.profile,
        mclc: mc.mclc(true),
      });
      return {
        account: publicAccount(mc.profile),
        mclc: mc.mclc(true),
      };
    }
  } catch (err) {
    console.warn("Session restore failed:", err);
    clearAccount();
  }
  return null;
}

async function loginMicrosoft() {
  const auth = new Auth("select_account");
  const xbox = await auth.launch("electron", loginWindowOptions());
  const token = await xbox.getMinecraft();

  writeJson(paths().account, {
    xboxRefresh: xbox.save(),
    profile: token.profile,
  });

  return {
    account: publicAccount(token.profile),
    mclc: token.mclc(true),
  };
}

function logout() {
  clearAccount();
}

function peekAccount() {
  const stored = loadStored();
  return publicAccount(stored?.profile || null);
}

module.exports = {
  loginMicrosoft,
  restoreSession,
  logout,
  peekAccount,
};
