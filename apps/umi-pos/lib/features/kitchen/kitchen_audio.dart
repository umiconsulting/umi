import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

/// Los WAV breves están en el APK. Los clientes de desarrollo quedan en silencio.
final class KitchenAudio {
  AudioPlayer? _player;
  bool _disposed = false;
  Future<void> _pending = Future.value();
  int _epoch = 0;
  Future<void> play(String sound) {
    final epoch = _epoch;
    return _pending = _pending.then((_) => _play(sound, epoch));
  }

  Future<void> _play(String sound, int epoch) async {
    if (epoch != _epoch) return;
    if (_disposed ||
        kIsWeb ||
        defaultTargetPlatform != TargetPlatform.android ||
        !['arrival', 'overdue', 'ready'].contains(sound)) {
      return;
    }
    try {
      final player = _player ??= AudioPlayer();
      await player.setReleaseMode(ReleaseMode.release);
      if (!_disposed && epoch == _epoch) {
        final completed = player.onPlayerComplete.first;
        await player.play(AssetSource('audio/kitchen_$sound.wav'));
        debugPrint('kds.audio sound=$sound playback=started');
        await completed.timeout(const Duration(seconds: 2), onTimeout: () {});
      }
    } catch (_) {
      // Un fallo de audio conserva el tablero y las señales visuales.
    }
  }

  Future<void> silence() async {
    _epoch++;
    try {
      await _player?.stop();
    } catch (_) {
      /* El tablero sigue disponible. */
    }
  }

  void dispose() {
    _disposed = true;
    _epoch++;
    unawaited(_player?.dispose());
  }
}
