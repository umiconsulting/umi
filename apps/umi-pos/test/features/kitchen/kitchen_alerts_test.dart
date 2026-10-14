import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/kitchen/kitchen_alerts.dart';
import 'kitchen_board_test.dart' as fixture;

KitchenOrderProjection ticket({
  String id = 'one',
  String status = 'queued',
  bool enabled = true,
  int? target,
  String station = 'barra',
}) => KitchenOrderProjection.fromJson({
  ...fixture.order().toJson(),
  'id': id,
  'status': status,
  'stationId': station,
  'stationName': station,
  'soundsEnabled': enabled,
  'items': [
    {...fixture.itemJson(fixture.itemLatte, 'Latte'), 'targetSeconds': target},
  ],
});

void main() {
  final start = DateTime.parse('2026-09-16T17:58:00Z');
  test('a newly visible cancellation is not a new preparation alert', () {
    final tracker = KitchenAlertTracker();
    tracker.observe([], start);
    final cancelled = ticket(status: 'cancelled');
    expect(
      tracker.observe([cancelled], start.add(const Duration(hours: 2))),
      isEmpty,
    );
    expect(kitchenStationStatus(cancelled), 'cancelled');
  });
  test(
    'station status distinguishes the local drink from global partial readiness',
    () {
      final localReady = KitchenOrderProjection.fromJson({
        ...ticket(status: 'partially_ready').toJson(),
        'items': [
          fixture.itemJson(fixture.itemLatte, 'Latte', status: 'ready'),
        ],
      });
      expect(kitchenStationStatus(localReady), 'ready');
      expect(localReady.status, 'partially_ready');
      expect(kitchenStationStatus(ticket(status: 'partially_ready')), 'queued');
    },
  );
  test(
    'station defaults, route objective and terminal states determine urgency',
    () {
      expect(
        kitchenOrderOverdue(ticket(), start.add(const Duration(seconds: 299))),
        isFalse,
      );
      expect(
        kitchenOrderOverdue(ticket(), start.add(const Duration(seconds: 300))),
        isTrue,
      );
      expect(
        kitchenOrderOverdue(
          ticket(station: 'cocina'),
          start.add(const Duration(seconds: 899)),
        ),
        isFalse,
      );
      expect(
        kitchenOrderOverdue(
          ticket(station: 'cocina'),
          start.add(const Duration(seconds: 900)),
        ),
        isTrue,
      );
      expect(
        kitchenOrderOverdue(
          ticket(target: 30),
          start.add(const Duration(seconds: 30)),
        ),
        isTrue,
      );
      for (final status in ['ready', 'completed', 'cancelled']) {
        expect(
          kitchenOrderOverdue(
            ticket(status: status),
            start.add(const Duration(hours: 1)),
          ),
          isFalse,
        );
      }
      expect(
        kitchenOrderOverdue(
          ticket(status: 'exception'),
          start.add(const Duration(hours: 1)),
        ),
        isTrue,
      );
      final unrouted = KitchenOrderProjection.fromJson({
        ...ticket(status: 'exception').toJson(),
        'items': [
          fixture.itemJson(fixture.itemLatte, 'Latte', status: 'exception'),
        ],
      });
      expect(
        kitchenOrderOverdue(unrouted, start.add(const Duration(hours: 1))),
        isFalse,
      );
      final held = KitchenOrderProjection.fromJson({
        ...ticket().toJson(),
        'items': [fixture.itemJson(fixture.itemLatte, 'Latte', fired: false)],
      });
      expect(
        kitchenOrderOverdue(held, start.add(const Duration(hours: 1))),
        isFalse,
      );
    },
  );
  test(
    'first read is silent, arrival and overdue sound once, only for own station',
    () {
      final tracker = KitchenAlertTracker();
      expect(tracker.observe([ticket()], start), isEmpty);
      expect(tracker.observe([ticket(), ticket(id: 'two')], start), [
        'arrival',
      ]);
      expect(
        tracker.observe([
          ticket(),
          ticket(id: 'two'),
        ], start.add(const Duration(minutes: 5))),
        ['overdue'],
      );
      expect(
        tracker.observe([
          ticket(),
          ticket(id: 'two'),
        ], start.add(const Duration(minutes: 6))),
        isEmpty,
      );
      expect(
        tracker.observe(
          [ticket(id: 'other', station: 'cocina')],
          start,
          stationId: 'barra',
        ),
        isEmpty,
      );
    },
  );
  test('muted and disabled arrivals are consumed without replay on unmute', () {
    final tracker = KitchenAlertTracker()..observe([], start);
    expect(tracker.observe([ticket()], start, muted: true), isEmpty);
    expect(tracker.observe([ticket()], start), isEmpty);
    expect(
      tracker.observe([ticket(id: 'disabled', enabled: false)], start),
      isEmpty,
    );
  });
  test('waiter hears new ready items, never a backlog or another account', () {
    final tracker = KitchenReadyTracker();
    const first = {'id': 'one', 'sound': 'ready'};
    const second = {'id': 'two', 'sound': 'ready'};
    expect(tracker.observe('account', [first]), isEmpty);
    expect(tracker.observe('account', [first, second]), ['ready']);
    expect(tracker.observe('account', [first, second]), isEmpty);
    expect(tracker.observe('other', [first, second]), isEmpty);
    expect(
      tracker.observe('other', [
        first,
        second,
        {'id': 'three', 'sound': null},
      ]),
      isEmpty,
    );
  });
}
