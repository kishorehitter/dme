import RNFS from 'react-native-fs';
import FileViewer from 'react-native-file-viewer';

export async function downloadAndInstallAPK(
  downloadUrl: string, 
  onProgress: (received: number, total: number) => void
): Promise<void> {
  const localFilePath = `${RNFS.CachesDirectoryPath}/DME_Update.apk`;

  // Clean up any stale files from previous attempts
  const fileExists = await RNFS.exists(localFilePath);
  if (fileExists) {
    await RNFS.unlink(localFilePath);
  }

  // Start the download
  const downloadResult = RNFS.downloadFile({
    fromUrl: downloadUrl,
    toFile: localFilePath,
    progress: (res) => {
      onProgress(res.bytesWritten, res.contentLength);
    },
    progressDivider: 1,
  });

  await downloadResult.promise;

  // Launch the Android Package Installer via react-native-file-viewer
  await FileViewer.open(localFilePath, { showOpenWithDialog: false });
}
