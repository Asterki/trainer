/**
 * Backup validation and browser download.
 *
 * Only the user's own data is exported. The seeded wger catalogue is code,
 * not user data, and is never included.
 */

import { todayIso } from './date';
import type { BackupFile } from './types';

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Structural gate; records are normalized by the store after this check. */
export function parseBackup(value: unknown): BackupFile {
  const file = record(value);

  if (file.app !== 'trainer') {
    throw new BackupValidationError('This is not a Trainer backup.');
  }
  if (typeof file.version !== 'number' || !Number.isInteger(file.version)) {
    throw new BackupValidationError('This backup has no valid version.');
  }
  if (file.version > 1) {
    throw new BackupValidationError('This backup was made by a newer Trainer.');
  }
  if (file.version !== 1) {
    throw new BackupValidationError('This backup version is not supported.');
  }
  if (
    !Array.isArray(file.routines) ||
    !Array.isArray(file.sessions) ||
    !Array.isArray(file.customExercises)
  ) {
    throw new BackupValidationError('This backup is missing routines, sessions or exercises.');
  }
  if (file.settings === null || typeof file.settings !== 'object' || Array.isArray(file.settings)) {
    throw new BackupValidationError('This backup is missing settings.');
  }
  if (typeof file.exportedAt !== 'string') {
    throw new BackupValidationError('This backup is missing its export date.');
  }

  return file as unknown as BackupFile;
}

export async function readBackupFile(file: File): Promise<BackupFile> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupValidationError('Backup files must be 10 MB or smaller.');
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new BackupValidationError('That file could not be read.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupValidationError('That file is not valid JSON.');
  }

  return parseBackup(parsed);
}

export function serializeBackup(backup: BackupFile): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function backupFileName(date = todayIso()): string {
  return `trainer-backup-${date}.json`;
}

export function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([serializeBackup(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backupFileName();
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
