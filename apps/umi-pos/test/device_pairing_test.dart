import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/storage/storage.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/entry/entry_surface.dart';
import 'package:umi_pos/shared/widgets/station_signature.dart';

// The product's own fonts: without them the test lays out with the engine's box font and the
// geometry would not be the geometry the till draws.
import 'receipt_document_test.dart' show fonts;
import 'support/fakes.dart';

const _installationId = '00000000-0000-4000-8000-000000000001';
const _sessionId = '00000000-0000-4000-8000-000000000002';
const _deviceId = '00000000-0000-4000-8000-000000000003';
const _publicId = '00000000-0000-4000-8000-000000000004';
const _merchantId = '00000000-0000-4000-8000-000000000005';
const _locationId = '00000000-0000-4000-8000-000000000006';
const _secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

void main() {
  testWidgets(
    'a stalled credential read offers recovery instead of a spinner',
    (tester) async {
      final storage = _StalledReadStorage();
      final controller = _controller(
        _PairingGateway(),
        CredentialVault(storage),
      );
      addTearDown(controller.dispose);

      unawaited(controller.initialize());
      await tester.pump();
      expect(controller.state.phase, EntryPhase.checkingDevice);

      await tester.pump(const Duration(seconds: 11));
      expect(controller.state.phase, EntryPhase.storageFailure);
      expect(controller.state.errorCode, 'ENTRY_STORAGE_TIMEOUT');

      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          theme: UmiTheme.light(),
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: EntrySurface(controller: controller),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Almacenamiento seguro no disponible'), findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);
    },
  );

  testWidgets(
    'another POS session explains the conflict and permits another PIN',
    (tester) async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      await vault.saveDevice(
        id: _deviceId,
        publicId: _publicId,
        credential: _secret,
        credentialVersion: 1,
        state: 'active',
        merchantId: _merchantId,
        locationId: _locationId,
      );
      final gateway = _PairingGateway()..failOperatorBusy = true;
      final controller = _controller(gateway, vault);
      addTearDown(controller.dispose);
      addTearDown(gateway.dispose);
      await controller.initialize();
      await controller.loginWithPin('2468');
      expect(controller.state.phase, EntryPhase.operatorRequired);
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: ListenableBuilder(
            listenable: controller,
            builder: (_, _) => EntrySurface(controller: controller),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Este usuario ya tiene una sesión abierta en otro POS. Cierra la sesión allí o entra con otro usuario.',
        ),
        findsOneWidget,
      );
      final logout = AppLocalizations.of(
        tester.element(find.byType(EntrySurface)),
      ).logoutAction;
      await tester.tap(find.text(logout));
      await tester.pumpAndSettle();
      expect(controller.state.phase, EntryPhase.pinRequired);
      expect(gateway.logouts, 1);
      expect(controller.state.errorCode, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  test(
    'pairing credentials persist in secure storage and clear safely',
    () async {
      final storage = MemorySecureStorage();
      final vault = CredentialVault(storage);
      storage.values['device.installation_id'] = _installationId;

      await vault.savePairing(
        sessionId: _sessionId,
        pollingCredential: _secret,
        expiresAt: DateTime.now()
            .add(const Duration(minutes: 5))
            .toIso8601String(),
      );

      final restored = await vault.pairingIdentity();
      expect(restored?.sessionId, _sessionId);
      expect(restored?.pollingCredential, _secret);

      await vault.clearPairing();
      expect(await vault.pairingIdentity(), isNull);
    },
  );

  test(
    'approved pairing stores one credential and acknowledges delivery',
    () async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      final gateway = _PairingGateway();
      final controller = _controller(gateway, vault);

      await controller.enroll('ABCDEFGH');
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(controller.state.phase, EntryPhase.pinRequired);
      expect((await vault.deviceIdentity()).credential, _secret);
      expect(gateway.claimedCode, 'ABCDEFGH');
      expect(gateway.acknowledgements, 1);
      expect(await vault.pairingIdentity(), isNull);
    },
  );

  // THE ENTRY ACTION HAS TO BE ON THE SCREEN, AT EVERY TEXT SIZE THE PRODUCT OFFERS.
  //
  // Ajustes offers `Muy grande`, which is a text scale of 2. On the iMin (1920x1080, a 1014 px
  // window) the sign-in screen collapsed to one column and `Continuar` left both the visible area
  // and the accessibility tree — the operator had to scroll a full-screen keypad to sign in, and
  // the people who choose the largest text are the least able to do that. Measured on the physical
  // till on 2026-10-11 (docs/reports/2026-10-11-imin-device-retest.md, defect 2).
  //
  // The assertion is the one a person makes: the action is inside the window and it is tappable
  // where it stands, with no scrolling.
  for (final phase in ['sign-in', 'enrollment']) {
    for (final scale in [1.0, 1.5, 2.0]) {
      testWidgets('the $phase action stays on screen at ${(scale * 100).round()}% text', (
        tester,
      ) async {
        await fonts();
        // THE iMin'S OWN SCREEN, ITS OWN DENSITY. 1920x1080 device pixels at 220 dpi is a
        // device pixel ratio of 1.375, and the navigation bar leaves the app a 1014-pixel-tall
        // window: 1396 x 737 LOGICAL pixels. A test at 1920x1014 logical is a canvas half again
        // as tall as the till's, and it reported this screen as fitting when the device shows it
        // clipped (measured 2026-10-11).
        tester.view.physicalSize = const Size(1920, 1014);
        tester.view.devicePixelRatio = 1.375;
        addTearDown(tester.view.reset);
        final windowHeight =
            tester.view.physicalSize.height / tester.view.devicePixelRatio;
        final storage = MemorySecureStorage();
        storage.values['device.installation_id'] = _installationId;
        final vault = CredentialVault(storage);
        final controller = _controller(_PairingGateway(), vault);
        // The pairing channel is waited on, and this is a widget test: the clock is fake until
        // something pumps it, so the real-async escape hatch is what lets it finish. Enrollment is
        // the phase a terminal starts in; the sign-in screen is the phase every shift after that
        // starts in.
        await tester.runAsync(() async {
          if (phase == 'sign-in') {
            await controller.enroll('ABCDEFGH');
          } else {
            await controller.initialize();
          }
          await Future<void>.delayed(const Duration(milliseconds: 20));
        });
        expect(
          controller.state.phase,
          phase == 'sign-in'
              ? EntryPhase.pinRequired
              : EntryPhase.enrollmentRequired,
        );

        await tester.pumpWidget(
          PosApp(
            locale: const Locale('es'),
            theme: UmiTheme.light(),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
            ],
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: EntrySurface(controller: controller),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 50));

        final action = find.text('Continuar');
        expect(action, findsOneWidget, reason: 'the $phase action is missing');
        final rect = tester.getRect(action);
        expect(
          rect.bottom,
          lessThanOrEqualTo(windowHeight),
          reason:
              'the $phase action sits below the window at ${(scale * 100).round()}% text',
        );
        expect(
          action.hitTestable(),
          findsOneWidget,
          reason:
              'the $phase action is not tappable where it stands at '
              '${(scale * 100).round()}% text, so it needs a scroll to reach',
        );
        if (phase == 'sign-in') {
          // The keypad is the whole screen. The owner asked on 2026-10-11 for the
          // terminal's own mark and its promise to leave this side of it, so the
          // screen holds the task and nothing above it. The cover keeps its own
          // mark on a window wide enough to show it, so the assertions name the
          // form column rather than the whole window.
          final form = find.byKey(const ValueKey('entry-form'));
          expect(find.byType(StationSignature), findsNothing);
          expect(
            find.descendant(of: form, matching: find.text('umi')),
            findsNothing,
          );
          expect(
            find.descendant(of: form, matching: find.text('Estación')),
            findsNothing,
          );
          expect(
            find.text('Tu PIN te identifica y carga tus permisos actuales.'),
            findsNothing,
          );
          expect(find.text('Ingresa tu PIN de operador'), findsOneWidget);
        }
        controller.dispose();
      });
    }
  }

  test('bootstrap resumes a persisted pairing session after restart', () async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.savePairing(
      sessionId: _sessionId,
      pollingCredential: _secret,
      expiresAt: DateTime.now()
          .add(const Duration(minutes: 5))
          .toIso8601String(),
    );
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);

    await controller.initialize();
    await Future<void>.delayed(const Duration(milliseconds: 20));

    expect(controller.state.phase, EntryPhase.pinRequired);
    expect((await vault.deviceIdentity()).publicId, _publicId);
    expect(gateway.polls, 1);
  });

  group('realtime pairing nudge', () {
    Future<(_PairingGateway, CredentialVault, EntryController)>
    waiting() async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      final gateway = _PairingGateway()..pollState = 'awaiting_approval';
      addTearDown(gateway.dispose);
      final controller = _controller(gateway, vault);
      addTearDown(controller.dispose);

      await controller.enroll('ABCDEFGH');
      await Future<void>.delayed(const Duration(milliseconds: 20));

      // One poll happened, it reported awaiting_approval, and the loop is now
      // asleep for 30 s. Anything that follows can only come from the nudge.
      expect(controller.state.phase, EntryPhase.enrollmentPending);
      expect(gateway.polls, 1);
      return (gateway, vault, controller);
    }

    test(
      'a nudge collects the credential without waiting for the poll',
      () async {
        final (gateway, vault, controller) = await waiting();

        gateway.pollState = 'credential_delivered';
        gateway.nudges.add(null);
        await Future<void>.delayed(const Duration(milliseconds: 20));

        expect(controller.state.phase, EntryPhase.pinRequired);
        expect(
          gateway.polls,
          2,
          reason: 'one from the loop, one from the nudge',
        );
        expect(
          gateway.acknowledgements,
          1,
          reason: 'the credential is stored once',
        );
        expect((await vault.deviceIdentity()).credential, _secret);
        expect(await vault.pairingIdentity(), isNull);
      },
    );

    test('a burst of nudges still stores the credential once', () async {
      final (gateway, _, controller) = await waiting();

      gateway.pollState = 'credential_delivered';
      gateway.nudges
        ..add(null)
        ..add(null)
        ..add(null);
      await Future<void>.delayed(const Duration(milliseconds: 40));

      expect(controller.state.phase, EntryPhase.pinRequired);
      expect(gateway.acknowledgements, 1);
    });

    test('a nudge after cancel does nothing', () async {
      final (gateway, _, controller) = await waiting();

      await controller.cancelPairing();
      final pollsAtCancel = gateway.polls;
      gateway.pollState = 'credential_delivered';
      gateway.nudges.add(null);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(controller.state.phase, EntryPhase.enrollmentRequired);
      expect(gateway.polls, pollsAtCancel);
      expect(gateway.acknowledgements, 0);
    });

    test('the realtime watch is released when the wait ends', () async {
      final (gateway, _, controller) = await waiting();
      expect(
        gateway.nudges.hasListener,
        isTrue,
        reason: 'the wait watches for a nudge while it is pending',
      );

      await controller.cancelPairing();

      expect(
        gateway.nudges.hasListener,
        isFalse,
        reason:
            'a watch that outlives the pairing holds a listener on the '
            'realtime channel for the rest of the shift',
      );
    });

    test('a failing nudge channel leaves the poll loop in charge', () async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      final gateway = _PairingGateway();
      addTearDown(gateway.dispose);
      final controller = _controller(gateway, vault);
      addTearDown(controller.dispose);

      await controller.enroll('ABCDEFGH');
      gateway.nudges.addError(
        const AppException(
          category: AppErrorCategory.transport,
          code: 'TRANSPORT_FAILURE',
          recoverable: true,
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 20));

      // Identical to the baseline with no realtime channel at all.
      expect(controller.state.phase, EntryPhase.pinRequired);
      expect(gateway.polls, 1);
      expect(gateway.acknowledgements, 1);
    });
  });

  testWidgets('enrollment asks for one setup code and no challenge id', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    final controller = _controller(_PairingGateway(), vault);
    await controller.initialize();

    await tester.pumpWidget(
      PosApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: EntrySurface(controller: controller),
      ),
    );

    expect(find.byType(PosField), findsOneWidget);
    expect(find.text('Challenge ID'), findsNothing);
    expect(find.text('Enrollment code'), findsOneWidget);
  });

  testWidgets('a four-digit operator PIN is not sent as a setup code', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);
    await controller.initialize();

    await tester.pumpWidget(
      PosApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: EntrySurface(controller: controller),
      ),
    );

    await tester.enterText(find.byType(PosField), '2468');
    await tester.tap(find.text('Continue'));
    await tester.pump();

    expect(gateway.claimedCode, isNull);
    expect(controller.state.phase, EntryPhase.enrollmentRequired);
  });

  testWidgets('a rejected setup code shows an inline field error', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    final gateway = _PairingGateway()..failClaim = true;
    final controller = _controller(gateway, vault);
    await controller.initialize();

    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: ListenableBuilder(
          listenable: controller,
          builder: (context, _) => EntrySurface(controller: controller),
        ),
      ),
    );

    await tester.enterText(find.byType(PosField), 'BADCODE1');
    await tester.pump();
    await tester.tap(find.text('Continuar'));
    await tester.pumpAndSettle();

    expect(controller.state.phase, EntryPhase.enrollmentRequired);
    expect(
      find.text(
        'El código de registro no es válido o caducó. Solicita un código nuevo al administrador.',
      ),
      findsOneWidget,
    );
    final field = tester.widget<PosField>(find.byType(PosField));
    expect(field.decoration?.errorText, isNotNull);
  });

  testWidgets('a setup code timeout shows an inline recovery error', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    final gateway = _PairingGateway()..claimFailureCode = 'REQUEST_TIMEOUT';
    final controller = _controller(gateway, vault);
    await controller.initialize();

    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: ListenableBuilder(
          listenable: controller,
          builder: (context, _) => EntrySurface(controller: controller),
        ),
      ),
    );

    await tester.enterText(find.byType(PosField), 'ABCDEFGH');
    await tester.pump();
    await tester.tap(find.text('Continuar'));
    await tester.pumpAndSettle();

    expect(controller.state.phase, EntryPhase.enrollmentRequired);
    expect(
      find.text(
        'UmiPOS no puede verificar este código ahora. Revisa la conexión e inténtalo de nuevo.',
      ),
      findsOneWidget,
    );
    final field = tester.widget<PosField>(find.byType(PosField));
    expect(field.decoration?.errorText, isNotNull);
  });

  testWidgets(
    'PIN semantics announce the count without duplicating the title',
    (tester) async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      await vault.saveDevice(
        id: _deviceId,
        publicId: _publicId,
        credential: _secret,
        credentialVersion: 1,
        state: 'active',
        merchantId: _merchantId,
        locationId: _locationId,
      );
      final controller = _controller(_PairingGateway(), vault);
      await controller.initialize();
      final semantics = tester.ensureSemantics();
      try {
        await tester.pumpWidget(
          PosApp(
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
            ],
            supportedLocales: AppLocalizations.supportedLocales,
            home: EntrySurface(controller: controller),
          ),
        );
        final title = find.bySemanticsLabel(
          RegExp(r'^Enter your operator PIN$'),
        );
        expect(title, findsOneWidget);
        expect(
          tester.getSemantics(title),
          isSemantics(label: 'Enter your operator PIN', isHeader: true),
        );
        final count = find.bySemanticsLabel(RegExp(r'^Operator PIN$'));
        expect(count, findsOneWidget);
        expect(
          tester.getSemantics(count),
          isSemantics(
            label: 'Operator PIN',
            value: '0 digits',
            isLiveRegion: true,
          ),
        );
        for (final digit in const ['2', '4']) {
          await tester.tap(find.text(digit));
          await tester.pump();
        }
        expect(title, findsOneWidget);
        expect(
          tester.getSemantics(count),
          isSemantics(
            label: 'Operator PIN',
            value: '2 digits',
            isLiveRegion: true,
          ),
        );
      } finally {
        semantics.dispose();
        await tester.pumpWidget(const SizedBox.shrink());
        controller.dispose();
      }
    },
  );

  testWidgets('trusted device uses the personal PIN and loads cashier access', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      merchantId: _merchantId,
      locationId: _locationId,
    );
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);
    await controller.initialize();

    await tester.pumpWidget(
      PosApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: EntrySurface(controller: controller),
      ),
    );

    expect(find.text('Enter your operator PIN'), findsOneWidget);
    expect(find.text('Email'), findsNothing);
    expect(find.text('Use 4 to 8 digits.'), findsOneWidget);
    expect(find.text('0/8'), findsNothing);
    // The operator PIN is entered on an on-screen keypad now (audit F14), not a
    // text field: tap the digit keys.
    for (final digit in const ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(gateway.authenticatedPin, '2468');
    expect(controller.state.phase, EntryPhase.ready);
    expect(controller.state.operator?.permissions, contains('catalog.read'));
  });

  testWidgets('the screen that verifies the PIN carries no station mark', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      merchantId: _merchantId,
      locationId: _locationId,
    );
    final gateway = _PairingGateway()..pinHold = Completer<void>();
    final controller = _controller(gateway, vault);
    await controller.initialize();

    await tester.pumpWidget(
      PosApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: ListenableBuilder(
          listenable: controller,
          builder: (context, _) => EntrySurface(controller: controller),
        ),
      ),
    );
    for (final digit in const ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    // One frame, not a settle: the answer is held, so the screen under review
    // is the one the operator watches while the till verifies the PIN.
    await tester.pump();
    expect(controller.state.phase, EntryPhase.pinAuthenticating);
    expect(find.text('Verifying your PIN'), findsOneWidget);
    // The keypad is the PIN screen, and this loading belongs to it.
    expect(find.byType(StationSignature), findsNothing);
    expect(find.text('Station'), findsNothing);
    expect(find.text('Enter your operator PIN'), findsNothing);

    gateway.pinHold!.complete();
    await tester.pumpAndSettle();
    expect(controller.state.phase, EntryPhase.ready);
    controller.dispose();
  });

  test(
    'restart within the grace window restores the operator without a PIN',
    () async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      await vault.saveDevice(
        id: _deviceId,
        publicId: _publicId,
        credential: _secret,
        credentialVersion: 1,
        state: 'active',
        merchantId: _merchantId,
        locationId: _locationId,
      );
      // saveTokens stamps the last-proven time to now, inside the window.
      await vault.saveTokens('old-access', 'old-refresh');
      final gateway = _PairingGateway();
      final controller = _controller(gateway, vault);

      await controller.initialize();

      expect(gateway.refreshes, 1);
      expect(gateway.logouts, 0);
      expect(controller.state.phase, EntryPhase.ready);
      expect(await vault.refreshToken(), 'refresh2');
    },
  );

  test('a restart that will restore never publishes the keypad first', () async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      merchantId: _merchantId,
      locationId: _locationId,
    );
    await vault.saveTokens('old-access', 'old-refresh');
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);
    final seen = <EntryPhase>[];
    controller.addListener(() => seen.add(controller.state.phase));

    await controller.initialize();

    // The restore is the outcome, and the keypad must not have been on the way
    // to it. A cold till that draws a live keypad while it is still deciding
    // takes the PIN out of the operator's hands: the digits are discarded with
    // no rejection and the till lands in the previous operator's catalog. Two of
    // four digits were measured landing in exactly that window on the real
    // client, which is what this asserts against.
    expect(controller.state.phase, EntryPhase.ready);
    expect(seen, contains(EntryPhase.restoringSession));
    expect(seen, isNot(contains(EntryPhase.pinRequired)));
  });

  test('restart with a failed refresh falls back to the PIN', () async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      merchantId: _merchantId,
      locationId: _locationId,
    );
    await vault.saveTokens('old-access', 'old-refresh');
    final gateway = _PairingGateway()..failRefresh = true;
    final controller = _controller(gateway, vault);

    await controller.initialize();

    expect(gateway.refreshes, 1);
    expect(controller.state.phase, EntryPhase.pinRequired);
    expect(await vault.refreshToken(), isNull);
  });

  test('restart after the grace window requires the PIN', () async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      merchantId: _merchantId,
      locationId: _locationId,
    );
    await vault.saveTokens('old-access', 'old-refresh');
    // Move the last-proven time outside the restore window.
    storage.values['session.activity_at'] = DateTime.now()
        .toUtc()
        .subtract(const Duration(minutes: 10))
        .toIso8601String();
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);

    await controller.initialize();

    expect(gateway.refreshes, 0);
    expect(controller.state.phase, EntryPhase.pinRequired);
    expect(await vault.refreshToken(), isNull);
  });

  test('operator lock preserves the device branch for the next PIN', () async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      merchantId: _merchantId,
      locationId: _locationId,
    );
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);
    await controller.initialize();
    await controller.loginWithPin('2468');
    expect(controller.state.phase, EntryPhase.ready);

    await controller.lock();

    final identity = await vault.deviceIdentity();
    expect(identity.merchantId, _merchantId);
    expect(identity.locationId, _locationId);
    expect(controller.state.phase, EntryPhase.pinRequired);
    expect(controller.state.errorCode, isNull);

    await controller.loginWithPin('2468');

    expect(controller.state.phase, EntryPhase.ready);
    expect(controller.state.errorCode, isNull);
  });

  test(
    'operator lock fails locally closed without exposing a network error',
    () async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      await vault.saveDevice(
        id: _deviceId,
        publicId: _publicId,
        credential: _secret,
        credentialVersion: 1,
        state: 'active',
        merchantId: _merchantId,
        locationId: _locationId,
      );
      final gateway = _PairingGateway()..failLock = true;
      final controller = _controller(gateway, vault);
      await controller.initialize();
      await controller.loginWithPin('2468');

      await controller.lock();

      expect(controller.state.phase, EntryPhase.pinRequired);
      expect(controller.state.errorCode, isNull);
    },
  );

  test('an idle ready session locks itself and asks for the PIN', () {
    fakeAsync((async) {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      unawaited(
        vault.saveDevice(
          id: _deviceId,
          publicId: _publicId,
          credential: _secret,
          credentialVersion: 1,
          state: 'active',
          merchantId: _merchantId,
          locationId: _locationId,
        ),
      );
      async.flushMicrotasks();
      final gateway = _PairingGateway();
      final controller = EntryController(
        gateway: gateway,
        vault: vault,
        telemetry: SafeTelemetry(
          enabled: false,
          context: TelemetryContext.current(testConfig),
          exporter: RecordingExporter(),
        ),
        idleTimeout: const Duration(minutes: 30),
      );

      // No saved tokens, so the cold start lands on the PIN, not a restore.
      unawaited(controller.initialize());
      async.flushMicrotasks();
      expect(controller.state.phase, EntryPhase.pinRequired);

      unawaited(controller.loginWithPin('2468'));
      async.flushMicrotasks();
      expect(controller.state.phase, EntryPhase.ready);

      // A short interaction keeps it open; a long silence locks it.
      controller.noteActivity();
      async.elapse(const Duration(minutes: 20));
      async.flushMicrotasks();
      expect(controller.state.phase, EntryPhase.ready);

      async.elapse(const Duration(minutes: 31));
      async.flushMicrotasks();
      expect(controller.state.phase, EntryPhase.pinRequired);

      controller.dispose();
    });
  });
}

EntryController _controller(EntryGateway gateway, CredentialVault vault) {
  return EntryController(
    gateway: gateway,
    vault: vault,
    telemetry: SafeTelemetry(
      enabled: false,
      context: TelemetryContext.current(testConfig),
      exporter: RecordingExporter(),
    ),
  );
}

final class _StalledReadStorage implements SecureKeyValueStorage {
  final _delegate = MemorySecureStorage();
  final _blocked = Completer<String?>();

  @override
  Future<StorageHealth> healthCheck() => _delegate.healthCheck();

  @override
  Future<String?> read(String key) =>
      key == 'device.installation_id' ? _blocked.future : _delegate.read(key);

  @override
  Future<void> write(String key, String value) => _delegate.write(key, value);

  @override
  Future<void> delete(String key) => _delegate.delete(key);

  @override
  Future<void> deleteAll() => _delegate.deleteAll();
}

final class _PairingGateway implements EntryGateway {
  String? claimedCode;
  int polls = 0;
  int acknowledgements = 0;
  int logouts = 0;
  int refreshes = 0;
  bool failRefresh = false;
  bool failOperatorBusy = false;
  String? authenticatedPin;

  /// Pending work a test can hold the PIN answer behind, so the screen that
  /// shows while the till verifies the PIN can be read.
  Completer<void>? pinHold;
  bool failLock = false;
  bool failClaim = false;
  String? claimFailureCode;

  /// Drives the realtime nudge channel. A test adds to it to imitate the API
  /// announcing that the pairing state moved.
  final StreamController<void> nudges = StreamController<void>.broadcast();

  /// What the next poll reports. Tests flip it to 'credential_delivered' to
  /// imitate an administrator approving the request.
  String pollState = 'credential_delivered';

  @override
  Stream<void> watchPairing(PairingIdentity pairing) => nudges.stream;

  /// Closes the nudge channel. Tests register this with `addTearDown`.
  Future<void> dispose() => nudges.close();

  @override
  Future<DevicePairingSession> claimPairing(String code) async {
    claimedCode = code;
    if (failClaim || claimFailureCode != null) {
      throw AppException(
        category: AppErrorCategory.authentication,
        code: claimFailureCode ?? 'ENROLLMENT_REJECTED',
        recoverable: false,
      );
    }
    return DevicePairingSession(
      pairingSessionId: _sessionId,
      pollingCredential: _secret,
      state: 'awaiting_approval',
      expiresAt: DateTime.now()
          .add(const Duration(minutes: 5))
          .toIso8601String(),
      pollAfterSeconds: 1,
    );
  }

  @override
  Future<DevicePairingPollResponse> pollPairing(PairingIdentity pairing) async {
    polls++;
    if (pollState != 'credential_delivered') {
      return DevicePairingPollResponse(
        pairingSessionId: pairing.sessionId,
        state: pollState,
        expiresAt: pairing.expiresAt.toIso8601String(),
        pollAfterSeconds: 30,
        device: null,
        credential: null,
      );
    }
    return DevicePairingPollResponse(
      pairingSessionId: pairing.sessionId,
      state: 'credential_delivered',
      expiresAt: pairing.expiresAt.toIso8601String(),
      pollAfterSeconds: 1,
      device: {
        'id': _deviceId,
        'publicId': _publicId,
        'merchantId': _merchantId,
        'locationId': _locationId,
        'displayName': 'Front register',
        'type': 'pos_terminal',
        'platform': 'web',
        'mobility': 'static',
        'state': 'active',
        'credentialVersion': 1,
        'lastSeenAt': null,
        'rotationRequired': false,
        'revokedAt': null,
        'replacementDeviceId': null,
      },
      credential: _secret,
    );
  }

  @override
  Future<void> acknowledgePairing(
    PairingIdentity pairing,
    String deviceCredential,
  ) async {
    acknowledgements++;
  }

  @override
  Future<DeviceSummary> deviceStatus() async => const DeviceSummary(
    id: _deviceId,
    publicId: _publicId,
    merchantId: _merchantId,
    locationId: _locationId,
    displayName: 'Front register',
    type: 'pos_terminal',
    platform: 'web',
    mobility: 'static',
    state: 'active',
    credentialVersion: 1,
    lastSeenAt: null,
    rotationRequired: false,
    revokedAt: null,
    replacementDeviceId: null,
  );
  @override
  Future<PosSessionResponse> login(String username, String password) =>
      throw UnimplementedError();
  @override
  Future<PosSessionResponse> pinLogin({
    required String pin,
    required String merchantId,
    required String locationId,
  }) async {
    authenticatedPin = pin;
    await pinHold?.future;
    return const PosSessionResponse(
      session: {'id': 'session'},
      tokens: {'accessToken': 'access', 'refreshToken': 'refresh'},
    );
  }

  @override
  Future<PosSessionResponse> refresh() async {
    refreshes++;
    if (failRefresh) {
      throw AppException(
        category: AppErrorCategory.authentication,
        code: 'SESSION_EXPIRED',
        recoverable: false,
      );
    }
    return const PosSessionResponse(
      session: {'id': 'session'},
      tokens: {'accessToken': 'access2', 'refreshToken': 'refresh2'},
    );
  }

  @override
  Future<void> logout() async {
    logouts++;
  }

  @override
  Future<void> globalLogout() => throw UnimplementedError();
  @override
  Future<EntryContextResponse> entryContext() async =>
      const EntryContextResponse(
        merchants: [
          {
            'id': _merchantId,
            'name': 'Local business',
            'roles': ['cashier'],
            'permissions': ['catalog.read', 'cart.write', 'checkout.commit'],
            'locations': [
              {
                'id': _locationId,
                'merchantId': _merchantId,
                'name': 'Local branch',
                'status': 'active',
                'deviceAllowed': true,
                'operatorAllowed': true,
              },
            ],
            'entitlements': [
              {'key': 'pos', 'enabled': true},
            ],
          },
        ],
      );
  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) => failOperatorBusy
      ? Future.error(
          const AppException(
            category: AppErrorCategory.conflict,
            code: 'OPERATOR_SESSION_BUSY',
            recoverable: true,
          ),
        )
      : Future.value(
          OperatorSessionView(
            id: _sessionId,
            userId: '00000000-0000-4000-8000-000000000007',
            staffId: '00000000-0000-4000-8000-000000000008',
            merchantId: merchantId,
            locationId: locationId,
            deviceId: _deviceId,
            state: 'active',
            permissions: const [
              'catalog.read',
              'cart.write',
              'checkout.commit',
            ],
            entitlements: const [
              {'key': 'pos', 'enabled': true},
            ],
            startedAt: '2026-07-28T00:00:00.000Z',
            lastActivityAt: '2026-07-28T00:00:00.000Z',
            expiresAt: '2026-07-28T08:00:00.000Z',
          ),
        );
  @override
  Future<void> lockOperator(String id) async {
    if (failLock) {
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
    }
  }

  @override
  Future<void> endOperator(String id) => throw UnimplementedError();
  @override
  Future<ElevationGrantView> verifyPin({
    required String pin,
    required String permission,
    required String merchantId,
    required String locationId,
  }) => throw UnimplementedError();
  @override
  Future<ElevationGrantView> requestManagerApproval({
    required String operatorSessionId,
    required String managerPin,
    required String permission,
    required String merchantId,
    required String locationId,
    String? commandFingerprint,
  }) => throw UnimplementedError();
}
