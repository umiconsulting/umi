import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/cash/cash_controller.dart';
import 'package:umi_pos/features/cash/cash_repository.dart';

/// The Caja screen's worst failure is not a wrong number, it is a screen that
/// never stops loading. `load()` used to catch `AppException` only, so a failure
/// the API did not describe — a closed socket, a payload the parser refused, a
/// bug in the controller — escaped the handler and left `busy` true forever. The
/// surface then rendered a bare spinner: no message, no recovery action, and the
/// refresh icon in the app bar disabled because the controller still believed it
/// was working.
///
/// Found by driving the running native app against a failing API (defect D26 in
/// the plan of record). These two tests pin both halves of the fix: the
/// controller clears `busy` and names the failure, whatever the failure was.
final class _FailingRepository implements CashRepository {
  _FailingRepository(this.failure);

  /// Thrown from `center()`. Anything that is not an `AppException` is the case
  /// that used to wedge the screen.
  final Object failure;
  int centerCalls = 0;

  @override
  Future<CashCenterSnapshot> center(
    String merchantId,
    CashCenterQuery query,
  ) async {
    centerCalls += 1;
    throw failure;
  }

  // The rest of the interface is not exercised by these two tests.
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not used here');
}

void main() {
  test('a failure the API did not describe still clears busy and names itself', () async {
    final repository = _FailingRepository(
      StateError('the socket closed mid-load'),
    );
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
    );

    await controller.load();

    expect(repository.centerCalls, 1);
    expect(
      controller.state.busy,
      isFalse,
      reason: 'a busy that never clears is the spinner that never ends',
    );
    expect(
      controller.state.errorCode,
      CashController.unexpectedFailureCode,
      reason: 'the screen needs a code to explain the failure with',
    );
  });

  test('a load that fails can be retried, and the retry reaches the server', () async {
    final repository = _FailingRepository(StateError('offline'));
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
    );

    await controller.load();
    await controller.load();

    expect(
      repository.centerCalls,
      2,
      reason: 'the recovery action must actually try again, not be a dead button',
    );
    expect(controller.state.busy, isFalse);
  });
}
