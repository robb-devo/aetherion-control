import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';
import { isInstallableApkUrl, releaseSizeMatches } from '@/lib/appUpdate';

export const ANDROID_PACKAGE = 'com.aetherion.control';

const FLAG_GRANT_READ_URI_PERMISSION = 1;

export type DownloadProgress = {
  written: number;
  total: number | null;
};

/**
 * Downloads a release APK and leaves it in cache for Android's package installer.
 * The system confirmation dialog is mandatory for a sideloaded app and is not bypassed.
 */
export async function downloadReleaseApk(
  url: string,
  expectedSize: number,
  onProgress: (progress: DownloadProgress) => void,
): Promise<{ bytes: number }> {
  if (Platform.OS !== 'android') {
    throw new Error('APK installs run on Android. Open the release on this device instead.');
  }
  if (!isInstallableApkUrl(url)) {
    throw new Error('Refusing to download an APK that is not from the control API or this repository\'s GitHub releases.');
  }
  if (!releaseSizeMatches(expectedSize, expectedSize)) {
    throw new Error('The control API did not report an APK size, so the download was not started.');
  }

  const destination = new File(Paths.cache, 'aetherion-update.apk');
  if (destination.exists) destination.delete();

  const task = File.createDownloadTask(url, destination, {
    headers: {
      Accept: 'application/vnd.android.package-archive',
      'User-Agent': 'AETHERION-Control',
    },
    onProgress: ({ bytesWritten, totalBytes }) => {
      const reported = totalBytes > 0 ? totalBytes : expectedSize > 0 ? expectedSize : null;
      onProgress({ written: bytesWritten, total: reported });
    },
  });

  const file = await task.downloadAsync();
  if (!file) throw new Error('Download stopped before the APK finished.');
  if (!releaseSizeMatches(file.size, expectedSize)) {
    throw new Error(
      `Downloaded ${file.size} bytes, but the release asset is ${expectedSize} bytes. The installer was not opened.`,
    );
  }
  return { bytes: file.size };
}

export async function openSystemInstaller(): Promise<void> {
  const file = new File(Paths.cache, 'aetherion-update.apk');
  if (!file.exists || !file.contentUri) {
    throw new Error('The downloaded APK is no longer available. Download it again.');
  }
  // ACTION_VIEW + the package MIME type is the supported sideload path.
  // Android draws the install confirmation itself. A normal app cannot accept it.
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    type: 'application/vnd.android.package-archive',
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

export async function openInstallPermissionSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
    data: `package:${ANDROID_PACKAGE}`,
  });
}

export function openReleasePage(url: string) {
  return Linking.openURL(url);
}
