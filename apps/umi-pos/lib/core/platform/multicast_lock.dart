import 'dart:io';

import 'package:flutter/services.dart';

const _channel = MethodChannel('umi/multicast');

/// Android filters Wi-Fi multicast until an app holds a `MulticastLock`.
///
/// Other platforms need no lock. A platform-channel failure is treated as an
/// unavailable discovery aid; the configured LAN URL remains the fallback.
Future<bool> acquireMulticastLock() async {
  if (!Platform.isAndroid) return false;
  try {
    await _channel.invokeMethod<void>('acquire');
    return true;
  } on Object {
    return false;
  }
}

Future<void> releaseMulticastLock(bool acquired) async {
  if (!acquired || !Platform.isAndroid) return;
  try {
    await _channel.invokeMethod<void>('release');
  } on Object {
    // Process teardown releases the underlying lock.
  }
}
