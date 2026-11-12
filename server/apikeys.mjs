// Personal AI API keys, scoped to the signed-in Lockbox user. Only a SHA-256 fingerprint is stored;
// the plaintext key is returned once, when it is created.
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { writeAtomic } from './crypto.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const view = ({ hash, ...k }) => k;

export function createKeyStore({ file, encrypt, decrypt }) {
  const load = async () => { try { return decrypt(await readFile(file)); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } };
  let queue = Promise.resolve();
  const mutate = fn => (queue = queue.then(async () => { const db = await load(); const out = await fn(db); await writeAtomic(file, encrypt(db)); return out; }));
  return {
    list: async user => ((await load())[user] || []).map(view),
    create: (user, rawName) => {
      const name = String(rawName || '').trim().slice(0, 60);
      if (!name) return Promise.reject(Object.assign(new Error('name_required'), { status: 400 }));
      const key = 'lbx_' + randomBytes(32).toString('base64url');
      const rec = { id: randomBytes(9).toString('base64url'), name, last4: key.slice(-4), hash: sha(key), createdAt: new Date().toISOString(), lastUsedAt: null };
      return mutate(db => { (db[user] ||= []).push(rec); if (db[user].length > 50) throw Object.assign(new Error('too_many_keys'), { status: 400 }); return { ...view(rec), key }; });
    },
    remove: (user, id) => mutate(db => { const before = (db[user] || []).length; db[user] = (db[user] || []).filter(k => k.id !== id); return db[user].length < before; }),
    /** Returns the owning user for a plaintext key and records its use, or null. */
    verify: key => mutate(db => {
      const h = Buffer.from(sha(String(key || '')));
      for (const [user, keys] of Object.entries(db)) for (const k of keys) if (timingSafeEqual(Buffer.from(k.hash), h)) { k.lastUsedAt = new Date().toISOString(); return user; }
      return null;
    }),
  };
}
