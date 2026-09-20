import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

export const defaultHome = () => process.env.JEV_MAIL_HOME || path.join(os.homedir(), '.config', 'jev-mail');
export async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error: any) { if (error.code === 'ENOENT') return undefined; throw new Error(`Cannot read ${path.basename(file)}: invalid or inaccessible file`); }
}
export async function writePrivate(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600);
  } finally { await fs.rm(temp, { force: true }); }
}
export interface Installation {
  schemaVersion: 1;
  scriptId: string;
  projectNumber: string;
  deploymentId?: string;
  contentHash?: string;
  version?: string;
  createdAt: string;
}
