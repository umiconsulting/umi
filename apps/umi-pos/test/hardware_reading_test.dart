import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/hardware/hardware_surface.dart';

/// THE STATE A CENTRE SHOWS IS THE STATE THE TILL MEASURED LAST.
///
/// The relay reads the hardware runtime every ten seconds while an operator session
/// is open. A centre that keeps the reading it loaded when it opened shows the state
/// of that moment, and the reading the relay just made never reaches the operator —
/// on the pilot till (2026-10-11) a printer that was found and printed while the
/// centre was open still read "Conectado" minutes later. These assertions are about
/// the fold that brings a newer reading into the reading a screen shows.
void main() {
  Map<String, Object?> device(String id, String state) => {
    'id': id,
    'deviceType': 'printer',
    'connectionState': state,
  };

  HardwareRuntimeSnapshot runtime({
    required String capturedAt,
    required List<Map<String, Object?>> devices,
    List<Map<String, Object?>>? jobs,
    int pendingJobs = 0,
    int unknownCommands = 0,
  }) => HardwareRuntimeSnapshot(
    merchantId: 'merchant',
    locationId: 'location',
    registerId: null,
    devices: devices,
    printJobs: jobs,
    pendingJobs: pendingJobs,
    retryableJobs: 0,
    unknownCommands: unknownCommands,
    capturedAt: capturedAt,
  );

  test('the newer state of a device replaces the state the screen holds', () {
    final shown = runtime(
      capturedAt: '2026-10-11T00:00:00.000Z',
      devices: [device('printer-1', 'connected'), device('drawer-1', 'unknown')],
    );
    final folded = adoptHardwareReading(
      shown: shown,
      reading: runtime(
        capturedAt: '2026-10-11T00:00:10.000Z',
        devices: [device('printer-1', 'disconnected')],
      ),
    );

    expect(folded.devices.first['connectionState'], 'disconnected');
    expect(folded.capturedAt, '2026-10-11T00:00:10.000Z');
    // A device the reading does not carry keeps the row the screen has. The centre
    // reads with the disabled devices included when an operator manages hardware,
    // and the relay reads without them, so the fold must not delete a row.
    expect(folded.devices, hasLength(2));
    expect(folded.devices.last['connectionState'], 'unknown');
  });

  test('the queue and the counters become the newer ones', () {
    final shown = runtime(
      capturedAt: '2026-10-11T00:00:00.000Z',
      devices: [device('printer-1', 'connected')],
      jobs: [
        {'jobId': 'job-1', 'status': 'printing'},
      ],
      pendingJobs: 1,
    );
    final folded = adoptHardwareReading(
      shown: shown,
      reading: runtime(
        capturedAt: '2026-10-11T00:00:10.000Z',
        devices: [device('printer-1', 'connected')],
        jobs: [
          {'jobId': 'job-1', 'status': 'printed'},
        ],
        unknownCommands: 1,
      ),
    );

    expect(folded.printJobs?.single['status'], 'printed');
    expect(folded.pendingJobs, 0);
    expect(folded.unknownCommands, 1);
  });

  test('a reading does not add a device the screen does not show', () {
    final folded = adoptHardwareReading(
      shown: runtime(
        capturedAt: '2026-10-11T00:00:00.000Z',
        devices: [device('printer-1', 'connected')],
      ),
      reading: runtime(
        capturedAt: '2026-10-11T00:00:10.000Z',
        devices: [device('printer-1', 'connected'), device('printer-2', 'connected')],
      ),
    );

    expect(folded.devices, hasLength(1));
  });
}
