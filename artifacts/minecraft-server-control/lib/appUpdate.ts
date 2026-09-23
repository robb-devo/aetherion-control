export const GITHUB_RELEASES_LATEST = 'https://api.github.com/repos/robb-devo/aetherion-control/releases/latest';
export const TRUSTED_APK_PREFIX = 'https://github.com/robb-devo/aetherion-control/releases/download/';

export type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  size?: number;
  content_type?: string;
};

export type ReleasePayload = {
  tag_name?: string;
  name?: string;
  body?: string | null;
  html_url?: string;
  assets?: ReleaseAsset[];
};

export type ApkRelease = {
  version: string;
  name: string;
  notes: string;
  url: string;
  pageUrl: string;
  size: number;
};

export type UpdateDecision =
  | { kind: 'update'; installed: string; release: ApkRelease }
  | { kind: 'current'; installed: string; release: ApkRelease }
  | { kind: 'ahead'; installed: string; release: ApkRelease }
  | { kind: 'unparsed'; installed: string; release: ApkRelease };

export class UpdateCheckError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'UpdateCheckError';
    this.status = status;
  }
}

export function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Positive when `left` is newer than `right`. Null when either side is not semver. */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function isTrustedApkUrl(url: string): boolean {
  return url.startsWith(TRUSTED_APK_PREFIX) && url.split('?')[0].toLowerCase().endsWith('.apk');
}

export function selectReleaseApk(release: ReleasePayload): ApkRelease | null {
  const tag = release.tag_name?.trim();
  if (!tag) return null;
  const asset = (release.assets ?? []).find((item) => {
    const url = item.browser_download_url ?? '';
    const name = item.name ?? '';
    return name.toLowerCase().endsWith('.apk') && isTrustedApkUrl(url) && typeof item.size === 'number' && item.size > 0;
  });
  if (!asset?.browser_download_url || asset.size == null) return null;
  const version = tag.replace(/^v/i, '');
  return {
    version,
    name: release.name?.trim() || tag,
    notes: (release.body ?? '').trim(),
    url: asset.browser_download_url,
    pageUrl: release.html_url?.trim() || `https://github.com/robb-devo/aetherion-control/releases/tag/${tag}`,
    size: asset.size,
  };
}

export function decideUpdate(installed: string, release: ApkRelease): UpdateDecision {
  const comparison = compareVersions(release.version, installed);
  if (comparison === null) return { kind: 'unparsed', installed, release };
  if (comparison > 0) return { kind: 'update', installed, release };
  if (comparison < 0) return { kind: 'ahead', installed, release };
  return { kind: 'current', installed, release };
}

export function releaseSizeMatches(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Number.isFinite(expected) && actual > 0 && actual === expected;
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  if (kb >= 1) return `${Math.round(kb)} KB`;
  return `${Math.round(bytes)} B`;
}

export async function fetchLatestRelease(fetcher: typeof fetch = fetch): Promise<ApkRelease> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(GITHUB_RELEASES_LATEST, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AETHERION-Control',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      throw new UpdateCheckError(
        response.status,
        'GitHub did not return the release list. If the repository is private, this phone cannot see it without a token, and this app will not embed one.',
      );
    }
    if (!response.ok) {
      throw new UpdateCheckError(response.status, `GitHub returned HTTP ${response.status} for the latest release.`);
    }
    const payload = (await response.json()) as ReleasePayload;
    const release = selectReleaseApk(payload);
    if (!release) {
      throw new Error('The latest GitHub release does not include an APK from this repository.');
    }
    return release;
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new Error('GitHub did not respond in time.');
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
