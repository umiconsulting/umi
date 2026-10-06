import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import 'kitchen_board_controller.dart';
import 'prep_list_model.dart';

enum PrepListPhase { idle, loading, ready, failure }

@immutable
final class PrepListState {
  const PrepListState({
    this.phase = PrepListPhase.idle,
    this.list,
    this.errorCode,
  });

  final PrepListPhase phase;

  /// The last list the server sent, kept while a refresh is in flight.
  final PrepListView? list;

  /// The code of the last refusal, or null.
  final String? errorCode;
}

/// The prep list for the board's Preparacion tab (plan 8.4).
///
/// This state is separate from the ticket board on purpose. The tickets are the
/// job on the rail, and the prep list is the other question a kitchen asks. A
/// failed prep read must not blank the rail, and a ticket bump must not clear
/// the list.
///
/// The list is read once when the tab opens and again only when the operator
/// asks. It is not polled: the forecast moves at the speed of the day, not at
/// the speed of a ticket.
final class PrepListController extends ChangeNotifier {
  PrepListController(this._repository);

  final KitchenBoardRepository _repository;
  PrepListState _state = const PrepListState();
  PrepListState get state => _state;
  int _generation = 0;
  bool _disposed = false;

  /// Read the list for the till's own merchant and location.
  ///
  /// [includeAbovePar] stays false for the board: the list exists to say what
  /// to make, and the server already drops the items that need nothing.
  Future<void> load(
    String merchantId, {
    required String locationId,
    required String operatorSessionId,
    bool includeAbovePar = false,
  }) async {
    final generation = ++_generation;
    _state = PrepListState(
      phase: PrepListPhase.loading,
      list: _state.list,
    );
    notifyListeners();
    try {
      final list = prepListView(
        await _repository.prepList(
          merchantId,
          PosPrepListQuery(
            locationId: locationId,
            operatorSessionId: operatorSessionId,
            includeAbovePar: includeAbovePar,
          ),
        ),
      );
      if (_disposed || generation != _generation) return;
      _state = PrepListState(phase: PrepListPhase.ready, list: list);
    } on AppException catch (error) {
      if (_disposed || generation != _generation) return;
      _state = PrepListState(
        phase: PrepListPhase.failure,
        list: _state.list,
        errorCode: error.code,
      );
    } catch (_) {
      if (_disposed || generation != _generation) return;
      _state = PrepListState(
        phase: PrepListPhase.failure,
        list: _state.list,
        errorCode: 'PREP_LIST_FAILED',
      );
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
