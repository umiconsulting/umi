import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

/// How long a tap took to become a painted frame.
///
/// WHY THIS EXISTS. The owner's requirement is that no tap feels slow, and the
/// only honest way to hold that is to measure it on the till rather than to
/// infer it. The first attempt measured it from outside — a `screenrecord
/// --bugreport` capture with the timestamp burned into each frame — and that
/// failed for a documented reason: the recorder emits a variable frame rate
/// with colliding DTS values, so the frame-to-time mapping cannot be trusted.
/// The camera was measuring the recorder, not the app.
///
/// The engine already knows the answer. `SchedulerBinding.addTimingsCallback`
/// reports every frame the rasteriser finished, with its build and raster
/// durations. Pairing that with the moment a pointer went down gives the number
/// the owner asked for, per tap, on the real device, with no capture in the way.
///
/// It is OFF unless the build asks for it: a counter on every press is a
/// diagnostic, not a feature, and a production till should not pay for it.
final class TapLatencyProbe {
  TapLatencyProbe({
    required this.report,
    this.enabled = true,
    this.responseWindow = const Duration(seconds: 1),
  });

  /// Where a measurement goes. The composition root wires this to telemetry, and
  /// a test wires it to a list.
  final void Function(TapLatency latency) report;
  final bool enabled;

  /// How long a tap may wait for a frame and still have that frame counted as
  /// ITS answer.
  ///
  /// Without a bound, a tap that repaints nothing — a press that lands on a
  /// disabled control, or on the gap between two of them — keeps its mark until
  /// some unrelated frame arrives, and that frame's time is reported as the
  /// tap's latency. Measured on the iMin before this bound existed: four working
  /// taps logged as 866, 2107, 3434 and 15167 ms, every one of them a background
  /// repaint answering a dead press.
  ///
  /// Past the window the tap is reported as [TapLatency.stalled] instead. That is
  /// the truthful reading of the same event from the operator's side: nothing
  /// appeared on the glass, so the press did not land.
  final Duration responseWindow;

  bool _attached = false;
  Stopwatch? _pending;
  Timer? _window;

  /// True while a tap is waiting for its frame. Exposed so a test can assert the
  /// mark was taken and released exactly once.
  bool get awaitingFrame => _pending != null;

  /// Start listening for frames. Safe to call twice.
  void attach() {
    if (!enabled || _attached) return;
    _attached = true;
    SchedulerBinding.instance.addTimingsCallback(_onTimings);
  }

  void dispose() {
    _window?.cancel();
    _window = null;
    if (!_attached) return;
    _attached = false;
    SchedulerBinding.instance.removeTimingsCallback(_onTimings);
  }

  /// A pointer went down.
  ///
  /// A second tap before the first one is answered replaces the mark rather than
  /// queueing: the operator's hand is the thing being measured, and two
  /// unanswered taps are one gesture that has not been painted yet.
  void mark() {
    if (!enabled) return;
    // AN ELAPSED WATCH, NOT A SHARED CLOCK. Two attempts to read both ends on a
    // clock the engine also publishes both failed on the device:
    // `currentSystemFrameTimeStamp` is the timestamp of the last frame the engine
    // BEGAN, so on an idle screen it is as stale as the last repaint — a mark
    // against it is answered by whatever frame arrives next. Pairing
    // `DateTime.now()` with `rasterFinishWallTime` looked right and was worse:
    // measured on the iMin, the two are not the same epoch, so no tap's own frame
    // ever satisfied the comparison and each mark was answered by the NEXT tap's
    // frame. Four working taps logged as 6-15 seconds.
    //
    // A watch measures one thing — elapsed time from the pointer landing to the
    // frame callback — and needs no agreement between two clocks to do it.
    markAt(Stopwatch()..start());
  }

  /// The testable core of [mark].
  void markAt(Stopwatch watch) {
    if (!enabled) return;
    _pending = watch;
    // A press that paints nothing schedules no frame, so waiting for one records
    // nothing at all — and "nothing at all" is the worst thing a till can do to
    // its operator. The window closing is itself the event; it does not need a
    // frame to arrive to be worth recording.
    _window?.cancel();
    _window = Timer(responseWindow, () {
      final pending = _pending;
      if (pending == null) return;
      _pending = null;
      report(TapLatency(latency: pending.elapsed, stalled: true));
    });
  }

  /// A frame reached the rasteriser. Called for the frames the engine reports,
  /// and directly by a test.
  ///
  /// Reports once per mark, and ONLY for a frame that began after the tap: the
  /// frames already in flight when the finger landed belong to whatever caused
  /// them, not to this tap.
  ///
  /// The answer is the time from the tap to the frame being rasterised — the
  /// moment the operator's change is on the glass. It is not the time the server
  /// took; a screen that paints an optimistic result and reconciles afterwards
  /// is exactly the shape this is meant to reward.
  bool noteFrame({Duration? build, Duration? raster}) {
    final watch = _pending;
    if (watch == null) return false;
    _pending = null;
    _window?.cancel();
    _window = null;
    final elapsed = watch.elapsed;
    if (elapsed > responseWindow) {
      // The frame is not this tap's answer, so it does not get to describe one.
      report(TapLatency(latency: elapsed, stalled: true));
      return true;
    }
    report(
      TapLatency(
        latency: elapsed,
        build: build,
        raster: raster,
      ),
    );
    return true;
  }

  void _onTimings(List<FrameTiming> timings) {
    if (timings.isEmpty || _pending == null) return;
    final frame = timings.first;
    noteFrame(build: frame.buildDuration, raster: frame.rasterDuration);
  }
}

@immutable
final class TapLatency {
  const TapLatency({
    required this.latency,
    this.build,
    this.raster,
    this.stalled = false,
  });

  /// Pointer-down to the frame that answered it.
  final Duration latency;

  /// True when no frame arrived inside the window: the press produced no visible
  /// response at all within [TapLatencyProbe.responseWindow].
  final bool stalled;

  /// The engine's own cost for that frame, when it reported one. A large build
  /// or raster means the frame itself was expensive; a large latency with small
  /// durations means the app was waiting on something else.
  final Duration? build;
  final Duration? raster;

  Map<String, Object?> toJson() => {
    'latencyMs': latency.inMilliseconds,
    if (stalled) 'stalled': true,
    if (build != null) 'buildMs': build!.inMilliseconds,
    if (raster != null) 'rasterMs': raster!.inMilliseconds,
  };

  @override
  String toString() =>
      stalled
      ? 'tap latency=${latency.inMilliseconds}ms STALLED (no frame in window)'
      : 'tap latency=${latency.inMilliseconds}ms '
            'build=${build?.inMilliseconds ?? -1}ms '
            'raster=${raster?.inMilliseconds ?? -1}ms';
}
