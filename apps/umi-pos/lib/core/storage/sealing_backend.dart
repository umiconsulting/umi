// Web-safe selector for the sealing backend. On a native (`dart:io`) target
// this re-exports the real `systemd-creds` backend; on the web it re-exports a
// stub that refuses, so the web build never pulls in `dart:io`. Callers import
// this file, never `sealing_backend_io.dart` directly.
export 'sealing_backend_stub.dart'
    if (dart.library.io) 'sealing_backend_io.dart';
