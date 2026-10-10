/**
 * The last database backup, as scripts/backup/backup.sh records it in AppSetting
 * `backup.last`, read for the 가져오기 · 내보내기 page.
 */
export interface BackupRecord {
  at: string;
  ok: boolean;
  file?: string;
  bytes?: number;
  tables?: number;
  kept?: number;
  keep?: number;
  intervalHours?: number;
  error?: string;
}

export type BackupState = { state: 'none' } | { state: 'ok' | 'stale' | 'failed'; record: BackupRecord; ageHours: number };

export function parseBackupRecord(value: string | null | undefined): BackupRecord | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<BackupRecord>;
    if (typeof v.at !== 'string' || Number.isNaN(Date.parse(v.at)) || typeof v.ok !== 'boolean') return null;
    return v as BackupRecord;
  } catch {
    return null;
  }
}

/** Stale once two intervals pass without a backup (a missed run is not yet a problem). */
export function backupState(value: string | null | undefined, now: number): BackupState {
  const record = parseBackupRecord(value);
  if (!record) return { state: 'none' };
  const ageHours = (now - Date.parse(record.at)) / 3_600_000;
  if (!record.ok) return { state: 'failed', record, ageHours };
  const limit = 2 * (record.intervalHours && record.intervalHours > 0 ? record.intervalHours : 24);
  return { state: ageHours > limit ? 'stale' : 'ok', record, ageHours };
}

/** "3시간 전", "2일 전" */
export function agoLabel(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}분 전`;
  if (hours < 48) return `${Math.round(hours)}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}
