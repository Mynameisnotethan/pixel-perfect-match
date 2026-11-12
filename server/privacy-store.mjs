// Each user's hide-from-AI rules, labels and defaults, encrypted on the data volume.
// The AI feed redacts from this copy, so an agent never depends on what a browser happens to hold.
import { encryptedFile } from './apikeys.mjs';
import { cleanPrivacy } from '../connectors/ai-feed.mjs';

export function createPrivacyStore(opts) {
  const f = encryptedFile(opts);
  let queue = Promise.resolve();
  return {
    get: async user => (await f.read())[user] || null,
    put: (user, body) => (queue = queue.then(async () => { const db = await f.read(); db[user] = cleanPrivacy(body); await f.write(db); return db[user]; })),
  };
}
