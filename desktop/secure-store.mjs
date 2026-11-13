// Encrypted, compressed desktop storage. The random AES key never sits beside the data:
// it is supplied by the OS credential vault. The binary format is MAGIC | IV | GCM tag | ciphertext.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const MAGIC = Buffer.from('LBX1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encode(value, key) {
  // Lossless: JSON values, Unicode, HTML and attachment data return exactly as supplied.
  const plain = gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 9 });
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

function decode(file, key) {
  if (file.length < MAGIC.length + IV_BYTES + TAG_BYTES || !file.subarray(0, 4).equals(MAGIC)) throw new Error('invalid_secure_store');
  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const dataStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv('aes-256-gcm', key, file.subarray(ivStart, tagStart));
  decipher.setAuthTag(file.subarray(tagStart, dataStart));
  const plain = Buffer.concat([decipher.update(file.subarray(dataStart)), decipher.final()]);
  return JSON.parse(gunzipSync(plain).toString('utf8'));
}

async function atomicWrite(file, data) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  try {
    await writeFile(temp, data, { mode: 0o600 });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

/** One document avoids many tiny files; gzip and AES-GCM provide compact, tamper-evident storage. */
export function createSecureStore({ file, getKey, setKey }) {
  let keyPromise;
  let loaded;
  let queue = Promise.resolve();
  const key = () => (keyPromise ||= (async () => {
    const existing = await getKey();
    if (existing) {
      const decoded = Buffer.from(existing, 'base64');
      if (decoded.length === 32) return decoded;
    }
    const made = randomBytes(32);
    await setKey(made.toString('base64'));
    return made;
  })());
  const readDocument = () => (loaded ||= (async () => {
    try { return decode(await readFile(file), await key()); }
    catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  })());
  const mutate = fn => (queue = queue.then(async () => {
    const document = await readDocument();
    const result = await fn(document);
    await atomicWrite(file, encode(document, await key()));
    return result;
  }));
  return {
    get: async (name, fallback = undefined) => {
      await queue;
      const document = await readDocument();
      return Object.hasOwn(document, name) ? document[name] : fallback;
    },
    put: (name, value) => mutate(document => { document[name] = value; }),
    remove: names => mutate(document => { for (const name of names) delete document[name]; }),
    clear: () => mutate(document => { for (const name of Object.keys(document)) delete document[name]; }),
    flush: () => queue,
  };
}

export const _test = { encode, decode };
