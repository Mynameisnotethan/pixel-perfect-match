// AES-256-GCM helpers for every file written to the data volume.
// The key lives on the volume (or in LOCKBOX_TOKEN_KEY), so a stolen disk file is useless without it.
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { writeFile, rename, mkdir } from 'node:fs/promises';

export const encryptWith = (key, obj) => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
};

export const decryptWith = (key, buf) => {
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString());
};

/** Writes bytes to <file>.tmp then renames, so a crash mid-write never leaves a half-written file. */
export async function writeAtomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + '.tmp', bytes, { mode: 0o600 });
  await rename(file + '.tmp', file);
}
