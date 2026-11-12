// Server-side API key store: the shared key logic, saved encrypted on the data volume.
import { readFile } from 'node:fs/promises';
import { writeAtomic } from './crypto.mjs';
import { createKeyStore as core } from '../connectors/keystore.mjs';

export const encryptedFile = ({ file, encrypt, decrypt }) => ({
  read: async () => { try { return decrypt(await readFile(file)); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } },
  write: db => writeAtomic(file, encrypt(db)),
});
export const createKeyStore = opts => core(encryptedFile(opts));
