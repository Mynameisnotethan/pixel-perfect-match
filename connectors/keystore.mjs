// Personal AI API keys, scoped to one Lockbox user. Only a SHA-256 fingerprint is stored;
// the plaintext key is returned once, when it is created. Storage is pluggable (encrypted file or OS vault).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const sha = s => createHash('sha256').update(s).digest('hex');
/** Key permissions. Keys made before permissions existed are read-only. */
export const READ_ONLY = Object.freeze({ read: true, drafts: false, send: false });
export const normalizePerms = p => ({ read: p?.read !== false, drafts: p?.drafts === true, send: p?.send === true && p?.drafts === true }); // sending only ever happens from a draft
const view = ({ hash, ...k }) => ({ ...k, perms: normalizePerms(k.perms) });

export function createKeyStore({ read, write }) {
  let queue = Promise.resolve();
  const mutate = fn => (queue = queue.then(async () => { const db = await read(); const out = await fn(db); await write(db); return out; }));
  return {
    list: async user => ((await read())[user] || []).map(view),
    create: (user, rawName) => {
      const name = String(rawName || '').trim().slice(0, 60);
      if (!name) return Promise.reject(Object.assign(new Error('name_required'), { status: 400 }));
      const key = 'lbx_' + randomBytes(32).toString('base64url');
      const rec = { id: randomBytes(9).toString('base64url'), name, last4: key.slice(-4), hash: sha(key), createdAt: new Date().toISOString(), lastUsedAt: null, perms: { ...READ_ONLY } };
      return mutate(db => { (db[user] ||= []).push(rec); if (db[user].length > 50) throw Object.assign(new Error('too_many_keys'), { status: 400 }); return { ...view(rec), key }; });
    },
    remove: (user, id) => mutate(db => { const before = (db[user] || []).length; db[user] = (db[user] || []).filter(k => k.id !== id); return db[user].length < before; }),
    /** Changes what one of this user's keys may do. Returns the updated key, or null when it is not theirs. */
    setPerms: (user, id, perms) => mutate(db => { const k = (db[user] || []).find(x => x.id === id); if (!k) return null; k.perms = normalizePerms(perms); return view(k); }),
    /** Like verify, but also returns which key it was and what it may do. */
    inspect: key => {
      if (!/^lbx_[A-Za-z0-9_-]{20,}$/.test(String(key || ''))) return Promise.resolve(null);
      return mutate(db => {
        const h = Buffer.from(sha(String(key)));
        for (const [user, keys] of Object.entries(db)) for (const k of keys) if (timingSafeEqual(Buffer.from(k.hash), h)) { k.lastUsedAt = new Date().toISOString(); return { user, keyId: k.id, perms: normalizePerms(k.perms) }; }
        return null;
      });
    },
    /** Returns the owning user for a plaintext key and records its use, or null. */
    verify: key => {
      if (!/^lbx_[A-Za-z0-9_-]{20,}$/.test(String(key || ''))) return Promise.resolve(null);
      return mutate(db => {
        const h = Buffer.from(sha(String(key)));
        for (const [user, keys] of Object.entries(db)) for (const k of keys) if (timingSafeEqual(Buffer.from(k.hash), h)) { k.lastUsedAt = new Date().toISOString(); return user; }
        return null;
      });
    },
  };
}
