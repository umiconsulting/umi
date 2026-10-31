import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchInventoryImportSnapshot, executeInventoryImportCommand } from '@/data.jsx';
import { runImportFileTask } from '@/lib/inventory-import/file-client.js';
import { buildImportPreview } from '@/lib/inventory-import/preview.js';
import {
  clearImportBatch,
  prepareImportBatch,
  readImportBatch,
  runImportBatch,
} from '@/lib/inventory-import/runner.js';
import { fileError, IMPORT_LIMITS } from '@/lib/inventory-import/schema.js';

export function useInventoryImportController({
  merchantId,
  locationId,
  kind,
  canManage,
  onClose,
  onSaved,
}) {
  const [identity] = useState({ merchantId, kind });
  const current = useRef({ merchantId, canManage });
  useLayoutEffect(() => {
    current.current = { merchantId, canManage };
  }, [merchantId, canManage]);
  const live = useRef(false);
  const fileWork = useRef(null);
  const runner = useRef(null);
  const busy = useRef(false);
  const storage = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [batch, setBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState(null);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const matches = () =>
    live.current && current.current.merchantId === identity.merchantId && current.current.canManage;

  useEffect(() => {
    live.current = true;
    let disposed = false;
    try {
      storage.current = window.localStorage;
      setBatch(readImportBatch(storage.current, identity.merchantId, identity.kind));
    } catch (cause) {
      setError(cause.code || 'STORAGE_READ_FAILED');
      setRecoveryFailed(true);
    }
    fetchInventoryImportSnapshot(identity.merchantId)
      .then((value) => {
        if (!disposed) setSnapshot(value);
      })
      .catch((cause) => {
        if (!disposed) setError(cause.code || 'COMMAND_FAILED');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      live.current = false;
      fileWork.current?.abort();
      runner.current?.abort();
    };
  }, [identity]);

  useEffect(() => {
    if (merchantId !== identity.merchantId || !canManage) {
      fileWork.current?.abort();
      runner.current?.abort();
      onClose();
    }
  }, [merchantId, identity, canManage, onClose]);

  function chooseFile(value) {
    fileWork.current?.abort();
    setWorking(false);
    setPreview(null);
    setError(null);
    setFile(value);
  }
  async function review() {
    if (!matches() || !snapshot || !file || batch || busy.current) return;
    fileWork.current?.abort();
    const task = new AbortController();
    fileWork.current = task;
    setWorking(true);
    setError(null);
    setPreview(null);
    try {
      const format = file.name.toLowerCase().endsWith('.xlsx')
        ? 'xlsx'
        : file.name.toLowerCase().endsWith('.csv')
          ? 'csv'
          : null;
      if (!format) throw fileError('UNSUPPORTED_FORMAT');
      if (file.size > IMPORT_LIMITS.maxBytes) throw fileError('FILE_TOO_LARGE');
      const bytes = await file.arrayBuffer();
      const parsed = await runImportFileTask(
        'parse',
        { kind: identity.kind, format, bytes },
        { signal: task.signal },
      );
      if (matches() && !task.signal.aborted)
        setPreview(buildImportPreview({ kind: identity.kind, parsed, snapshot }));
    } catch (cause) {
      if (matches() && !task.signal.aborted) setError(cause.code || 'WORKER_FAILED');
    } finally {
      if (matches() && fileWork.current === task) setWorking(false);
    }
  }
  async function run(savedBatch) {
    if (!matches() || busy.current) return;
    busy.current = true;
    setRunning(true);
    setStopped(false);
    setError(null);
    const task = new AbortController();
    runner.current = task;
    try {
      const result = await runImportBatch({
        batch: savedBatch,
        storage: storage.current,
        execute: executeInventoryImportCommand,
        signal: task.signal,
        isCurrentMerchant: (id) => matches() && current.current.merchantId === id,
        onProgress: async (value) => {
          if (matches()) {
            setBatch(value);
          }
          const selectedMerchant = storage.current.getItem('umi-dashboard-selected-merchant');
          if (
            (selectedMerchant || current.current.merchantId) === identity.merchantId &&
            value.entries.some((entry) => entry.executionStatus === 'success')
          )
            await onSaved();
        },
      });
      if (matches()) setBatch(result);
    } catch (cause) {
      if (matches()) {
        setError(cause.code || 'UNKNOWN_OUTCOME');
        try {
          setBatch(readImportBatch(storage.current, identity.merchantId, identity.kind));
        } catch {
          setRecoveryFailed(true);
        }
      }
    } finally {
      busy.current = false;
      if (matches()) setRunning(false);
    }
  }
  function confirm() {
    if (
      !matches() ||
      loading ||
      working ||
      !snapshot ||
      !preview ||
      batch ||
      recoveryFailed ||
      busy.current
    )
      return;
    try {
      const prepared = prepareImportBatch({
        merchantId: identity.merchantId,
        locationId: locationId || null,
        preview,
        storage: storage.current,
      });
      setBatch(prepared);
      setPreview(null);
      void run(prepared);
    } catch (cause) {
      setError(cause.code || 'STORAGE_WRITE_FAILED');
    }
  }
  function discard() {
    if (!matches() || busy.current || recoveryFailed) return;
    try {
      clearImportBatch(storage.current, identity.merchantId, identity.kind);
      setBatch(null);
      setPreview(null);
      setFile(null);
      setError(null);
      setSnapshot(null);
      setLoading(true);
      fetchInventoryImportSnapshot(identity.merchantId)
        .then((value) => {
          if (matches()) setSnapshot(value);
        })
        .catch((cause) => {
          if (matches()) setError(cause.code || 'COMMAND_FAILED');
        })
        .finally(() => {
          if (matches()) setLoading(false);
        });
    } catch (cause) {
      setError(cause.code || 'UNRESOLVED_BATCH');
    }
  }
  function stop() {
    runner.current?.abort();
    setStopped(true);
  }
  function close() {
    fileWork.current?.abort();
    runner.current?.abort();
    onClose();
  }
  return {
    snapshot,
    file,
    preview,
    batch,
    loading,
    working,
    running,
    stopped,
    error,
    recoveryFailed,
    active: merchantId === identity.merchantId && canManage,
    chooseFile,
    review,
    confirm,
    run,
    discard,
    stop,
    close,
  };
}
