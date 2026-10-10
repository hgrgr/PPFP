/**
 * Getting a file out of the app and back in. On the phone a file is written to the app's
 * cache and handed to Android's share sheet, where 드라이브 (Google Drive), Gmail or 파일 can
 * take it; choosing a file goes through the system picker, which shows Drive too. In a
 * browser (development) the file downloads.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function saveFile(name: string, text: string, mime = 'application/json'): Promise<'shared' | 'cancelled' | 'downloaded'> {
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await Share.share({ title: name, text: name, files: [r.uri], dialogTitle: '저장할 곳 고르기 (드라이브 등)' });
      return 'shared';
    } catch (e) {
      // Closing the share sheet without picking a place rejects with "Share canceled"
      if (/cancel/i.test(e instanceof Error ? e.message : String(e))) {
        await Filesystem.deleteFile({ path: name, directory: Directory.Cache }).catch(() => {});
        return 'cancelled';
      }
      throw e;
    }
    // Left in the cache when shared: the receiving app (Drive) may still be reading it
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

/** The text of a file the user picks (the input's change event hands it here). */
export async function readPicked(file: File, maxBytes = 50 * 1024 * 1024): Promise<string> {
  if (file.size > maxBytes) throw new Error('파일이 너무 큽니다.');
  return file.text();
}
