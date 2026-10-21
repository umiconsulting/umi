import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/observability/tap_latency_probe.dart';

/// The counter behind the owner's "no tap should feel slow" requirement.
///
/// These pin the arithmetic's contract, not the engine: whether a frame really
/// arrived is the device's answer, and the device is where the number is read.
/// What has to hold here is that one tap produces exactly one measurement, that
/// it carries the frame's own cost when the engine offered one, and that a build
/// which did not ask for the counter pays nothing.
void main() {
  test('one tap produces exactly one measurement', () {
    final reported = <TapLatency>[];
    final probe = TapLatencyProbe(report: reported.add);

    final watch = Stopwatch()..start();
    probe.markAt(watch);
    expect(probe.awaitingFrame, isTrue);
    final landed = probe.noteFrame(
      build: const Duration(milliseconds: 3),
      raster: const Duration(milliseconds: 4),
    );
    expect(landed, isTrue);
    expect(probe.awaitingFrame, isFalse);
    expect(reported, hasLength(1));
    expect(reported.single.build, const Duration(milliseconds: 3));
    expect(reported.single.raster, const Duration(milliseconds: 4));
    expect(reported.single.latency, greaterThanOrEqualTo(Duration.zero));

    // The frames that follow a tap are the rest of the animation, not a second
    // answer to "did my tap land?".
    probe.noteFrame();
    expect(reported, hasLength(1));
  });

  test('a frame with no tap behind it is not a measurement', () {
    final reported = <TapLatency>[];
    final probe = TapLatencyProbe(report: reported.add);
    expect(
      probe.noteFrame(
        build: const Duration(milliseconds: 2),
      ),
      isFalse,
    );
    expect(reported, isEmpty);
  });

  test('a second tap before the first is painted replaces the mark', () {
    final reported = <TapLatency>[];
    final probe = TapLatencyProbe(report: reported.add);
    probe.markAt(Stopwatch()..start());
    probe.markAt(Stopwatch()..start());
    probe.noteFrame();
    expect(reported, hasLength(1));
  });

  test('a press that paints nothing is reported as stalled, not as a latency', () {
    // The failure this bounds: a press on a disabled control, or on the gap
    // between two of them, keeps its mark until some unrelated frame arrives, and
    // that frame's distance is reported as the tap's own latency. On the iMin
    // that produced four working taps reported as 866-15167 ms.
    final reported = <TapLatency>[];
    final probe = TapLatencyProbe(
      report: reported.add,
      responseWindow: Duration.zero,
    );
    final watch = Stopwatch()..start();
    while (watch.elapsedMilliseconds < 2) {
      // Let the watch move past the window before the frame is offered.
    }
    probe.markAt(watch);

    expect(
      probe.noteFrame(build: const Duration(milliseconds: 3)),
      isTrue,
    );
    expect(reported.single.stalled, isTrue);
    // The frame is not this tap's answer, so it does not get to describe one.
    expect(reported.single.build, isNull);
    expect(reported.single.toJson().containsKey('stalled'), isTrue);
  });

  test('a press no frame ever answers is still reported when the window shuts', () async {
    // A dead press schedules no frame, so nothing would ever be recorded — and
    // "nothing recorded" reads identically to "nothing happened", which is the
    // one outcome the operator is least able to explain.
    final reported = <TapLatency>[];
    final probe = TapLatencyProbe(
      report: reported.add,
      responseWindow: const Duration(milliseconds: 30),
    );
    probe.markAt(Stopwatch()..start());
    expect(reported, isEmpty);

    await Future<void>.delayed(const Duration(milliseconds: 90));
    expect(reported, hasLength(1));
    expect(reported.single.stalled, isTrue);
    expect(probe.awaitingFrame, isFalse);

    // And a frame that turns up afterwards does not open a second record.
    probe.noteFrame(build: const Duration(milliseconds: 2));
    expect(reported, hasLength(1));
  });

  test('a build that did not ask for the counter pays nothing', () {
    final reported = <TapLatency>[];
    final probe = TapLatencyProbe(report: reported.add, enabled: false);
    probe.markAt(Stopwatch()..start());
    probe.noteFrame(
      build: const Duration(milliseconds: 1),
    );
    expect(probe.awaitingFrame, isFalse);
    expect(reported, isEmpty);
  });

  test('the measurement serializes to the fields a log can carry', () {
    const latency = TapLatency(
      latency: Duration(milliseconds: 168),
      build: Duration(milliseconds: 3),
      raster: Duration(milliseconds: 5),
    );
    expect(latency.toJson(), {
      'latencyMs': 168,
      'buildMs': 3,
      'rasterMs': 5,
    });
    // A frame the engine did not describe still reports its latency.
    expect(
      const TapLatency(latency: Duration(milliseconds: 40)).toJson(),
      {'latencyMs': 40},
    );
  });
}
