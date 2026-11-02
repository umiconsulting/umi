import { buildImportFile, parseImportFile } from './format.js';
import { fileError } from './schema.js';

self.onmessage = async ({ data: { action, payload } }) => {
  try {
    if (action !== 'parse' && action !== 'build') throw fileError('UNSUPPORTED_ACTION');
    const result = await (action === 'parse' ? parseImportFile(payload) : buildImportFile(payload));
    self.postMessage({ ok: true, result }, result.bytes ? [result.bytes] : []);
  } catch (error) {
    self.postMessage({ ok: false, error: { code: error.code || 'WORKER_FAILED' } });
  }
};
