// Web-safe selector for the TPM backend. On a native (`dart:io`) target this
// re-exports the real `tpm2-tools` backend; on the web it re-exports a stub
// that refuses, so the web build never pulls in `dart:io`. Callers import this
// file, never `tpm_backend_io.dart` directly.
export 'tpm_backend_stub.dart'
    if (dart.library.io) 'tpm_backend_io.dart';
