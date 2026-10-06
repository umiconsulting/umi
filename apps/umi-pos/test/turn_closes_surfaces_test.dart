import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/app/umi_pos_app.dart';

/// Stands in for the till's session: the test decides when the turn ends.
final class _Session extends ChangeNotifier {
  bool ready = true;

  void endTurn() {
    ready = false;
    notifyListeners();
  }
}

void main() {
  testWidgets('a till that locks closes the surface the turn had open', (
    tester,
  ) async {
    // The idle auto-lock swaps the PIN pad in underneath whatever is pushed on
    // top of it. Nothing popped those routes, so a till that locked itself
    // after half an hour left the operator on a cash screen saying it could not
    // read the drawer — with a Retry button that could not possibly work —
    // instead of the PIN pad it was actually asking for.
    final session = _Session();
    final navigator = GlobalKey<NavigatorState>();
    addTearDown(session.dispose);

    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: navigator,
        home: TurnClosesSurfaces(
          session: session,
          hasTurn: () => session.ready,
          child: const Scaffold(body: Text('El turno')),
        ),
      ),
    );
    await tester.pump();

    unawaited(
      navigator.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('Centro de caja')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Centro de caja'), findsOneWidget);

    session.endTurn();
    await tester.pumpAndSettle();

    // The pushed surface is gone and the till is back at its own screen, which
    // is where the PIN pad lives.
    expect(find.text('Centro de caja'), findsNothing);
    expect(find.text('El turno'), findsOneWidget);
  });

  testWidgets('an ordinary screen inside the turn is left alone', (
    tester,
  ) async {
    // The guard fires on the edge out of a ready turn, not on every rebuild, so
    // pushing a tool while the turn is live must not close it.
    final session = _Session();
    final navigator = GlobalKey<NavigatorState>();
    addTearDown(session.dispose);

    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: navigator,
        home: TurnClosesSurfaces(
          session: session,
          hasTurn: () => session.ready,
          child: const Scaffold(body: Text('El turno')),
        ),
      ),
    );
    await tester.pump();

    unawaited(
      navigator.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('Centro de caja')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    session.notifyListeners();
    await tester.pumpAndSettle();

    expect(find.text('Centro de caja'), findsOneWidget);
  });
}
