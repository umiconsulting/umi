import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/shared/widgets/connectivity_label.dart';

void main() {
  test('hub reachability is independent from cloud reachability', () {
    final connectivity = ConnectivityController();

    connectivity.networkDown();
    connectivity.hubReachable(selfHost: false);
    expect(connectivity.state, PosConnectivity.offline);
    expect(connectivity.hubState, PosHubState.reachable);

    connectivity.hubUnreachable();
    expect(connectivity.state, PosConnectivity.offline);
    expect(connectivity.hubState, PosHubState.unreachable);

    connectivity.hubNotConfigured();
    expect(connectivity.hubState, PosHubState.notConfigured);
  });

  testWidgets('the operator sees local, hub and cloud lanes', (tester) async {
    late String summary;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            summary = syncLaneSummary(
              context,
              cloud: PosConnectivity.offline,
              hub: PosHubState.reachable,
              pending: 2,
            );
            return const SizedBox();
          },
        ),
      ),
    );

    expect(summary, '2 saved on this device · LAN reachable · Cloud Offline');
  });
}
