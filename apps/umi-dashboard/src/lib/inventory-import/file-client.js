import { fileError, IMPORT_LIMITS } from './schema.js';

export async function runImportFileTask(action, payload, { signal } = {}) {
  if (action !== 'parse' && action !== 'build') throw fileError('UNSUPPORTED_ACTION');
  if (signal?.aborted) throw fileError('ABORTED');
  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    const finish = (error, result) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(fileError('ABORTED'));
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data?.ok === true) finish(null, data.result);
        else finish(fileError(data?.error?.code || 'WORKER_FAILED'));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(fileError('WORKER_FAILED'));
      };
      worker.onmessageerror = () => finish(fileError('WORKER_FAILED'));
      timer = setTimeout(() => finish(fileError('WORKER_TIMEOUT')), IMPORT_LIMITS.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      worker.postMessage({ action, payload }, action === 'parse' && payload.bytes instanceof ArrayBuffer ? [payload.bytes] : []);
    } catch {
      finish(fileError('WORKER_FAILED'));
    }
  });
}
