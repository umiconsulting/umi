import 'package:flutter/services.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/errors/operator_error_message.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/pin_entry.dart';
import '../../shared/widgets/station_document.dart';
import '../../shared/widgets/station_signature.dart';
import '../../shared/widgets/status_card.dart';
import 'entry_controller.dart';

final class EntrySurface extends StatelessWidget {
  const EntrySurface({required this.controller, super.key});
  final EntryController controller;
  @override
  Widget build(BuildContext context) => switch (controller.state.phase) {
    EntryPhase.checkingDevice ||
    EntryPhase.restoringSession ||
    EntryPhase.authenticating ||
    EntryPhase.pinAuthenticating ||
    EntryPhase.startingOperator => _EntryLoading(phase: controller.state.phase),
    EntryPhase.enrollmentRequired => _Enrollment(controller: controller),
    EntryPhase.enrollmentPending => _EnrollmentPending(controller: controller),
    EntryPhase.pinRequired => _PinLogin(controller: controller),
    EntryPhase.authenticationRequired => _Login(controller: controller),
    EntryPhase.tenantRequired => _TenantSelection(controller: controller),
    EntryPhase.branchRequired => _BranchSelection(controller: controller),
    EntryPhase.operatorRequired => _OperatorEntry(controller: controller),
    EntryPhase.ready => _ReadyShell(controller: controller),
    EntryPhase.deviceRevoked => _DeviceProblem(revoked: true),
    EntryPhase.rotationRequired => _DeviceProblem(revoked: false),
    EntryPhase.storageFailure ||
    EntryPhase.recoverableFailure => _Recovery(controller: controller),
  };
}

final class _Enrollment extends StatefulWidget {
  const _Enrollment({required this.controller});
  final EntryController controller;
  @override
  State<_Enrollment> createState() => _EnrollmentState();
}

final class _EnrollmentState extends State<_Enrollment> {
  final code = TextEditingController();
  bool _invalidCode = false;

  @override
  void dispose() {
    code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return _EntryFrame(
      // The mark stays off the enrollment screens (owner, 2026-10-16). A terminal
      // that has not been registered yet is not the place to advertise whose
      // software it runs; the PIN screen keeps the same rule.
      showSignature: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            l.enrollmentTitle,
            style: PosTheme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Text(l.enrollmentBody, textAlign: TextAlign.center),
          const SizedBox(height: UmiSpacing.lg),
          PosField(
            controller: code,
            decoration: PosFieldDecoration(
              labelText: l.enrollmentCodeLabel,
              errorText: _invalidCode
                  ? l.enrollmentCodeInvalid
                  : _enrollmentError(l, widget.controller.state.errorCode),
            ),
            textCapitalization: TextCapitalization.characters,
            textInputAction: TextInputAction.done,
            autocorrect: false,
            maxLength: 8,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp('[A-Za-z0-9]')),
              LengthLimitingTextInputFormatter(8),
            ],
            onChanged: (_) => setState(() => _invalidCode = false),
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: UmiSpacing.lg),
          SizedBox(
            width: double.infinity,
            child: PosButton(
              onPressed: code.text.length == 8 ? _submit : null,
              child: Text(l.continueAction),
            ),
          ),
        ],
      ),
    );
  }

  void _submit() {
    final normalized = code.text.replaceAll(RegExp('[^A-Za-z0-9]'), '');
    if (normalized.length != 8) {
      setState(() => _invalidCode = true);
      return;
    }
    setState(() => _invalidCode = false);
    widget.controller.enroll(normalized);
  }
}

String? _enrollmentError(AppLocalizations l, String? code) => switch (code) {
  null => null,
  'AUTHENTICATION_REQUIRED' ||
  'ENROLLMENT_REJECTED' => l.enrollmentCodeRejected,
  'ENROLLMENT_EXPIRED' => l.enrollmentCodeExpired,
  'ENROLLMENT_ATTEMPTS_EXCEEDED' => l.enrollmentCodeAttemptsExceeded,
  'RATE_LIMITED' => l.enrollmentCodeRateLimited,
  'TRANSPORT_FAILURE' ||
  'NETWORK_UNAVAILABLE' ||
  'REQUEST_TIMEOUT' => l.enrollmentCodeUnavailable,
  _ => l.enrollmentCodeUnavailable,
};

final class _EnrollmentPending extends StatelessWidget {
  const _EnrollmentPending({required this.controller});
  final EntryController controller;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return _EntryFrame(
      // Same rule as the code screen: no mark while the device waits to be let in.
      showSignature: false,
      child: Semantics(
        liveRegion: true,
        label: l.enrollmentPendingTitle,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const PosSpinner(),
            const SizedBox(height: UmiSpacing.lg),
            Text(
              l.enrollmentPendingTitle,
              style: PosTheme.of(context).textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: UmiSpacing.sm),
            Text(l.enrollmentPendingBody, textAlign: TextAlign.center),
            const SizedBox(height: UmiSpacing.sm),
            Text(
              l.enrollmentPendingSecure,
              textAlign: TextAlign.center,
              style: PosTheme.of(context).textTheme.bodySmall,
            ),
            if (controller.state.errorCode != null) ...[
              const SizedBox(height: UmiSpacing.md),
              Text(l.recoverableNetworkBody, textAlign: TextAlign.center),
              const SizedBox(height: UmiSpacing.sm),
              PosOutlineButton(
                onPressed: controller.retryPairing,
                child: Text(l.retryAction),
              ),
            ],
            const SizedBox(height: UmiSpacing.lg),
            PosTextButton(
              onPressed: controller.cancelPairing,
              child: Text(l.cancelEnrollmentAction),
            ),
          ],
        ),
      ),
    );
  }
}

final class _Login extends StatefulWidget {
  const _Login({required this.controller});
  final EntryController controller;
  @override
  State<_Login> createState() => _LoginState();
}

final class _PinLogin extends StatefulWidget {
  const _PinLogin({required this.controller});
  final EntryController controller;

  @override
  State<_PinLogin> createState() => _PinLoginState();
}

final class _PinLoginState extends State<_PinLogin> {
  final pin = TextEditingController();
  final focus = FocusNode();
  bool _tooShort = false;

  @override
  void dispose() {
    pin.dispose();
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final es = Localizations.localeOf(context).languageCode == 'es';
    final length = pin.text.length;
    // The largest text the product offers doubles every line, so the space BETWEEN blocks is what
    // gives way; the title, the hint, the dots, the keys and the action all stay.
    final largeText = MediaQuery.textScalerOf(context).scale(16) >= 24;
    final block = largeText ? UmiSpacing.md : UmiSpacing.lg;
    final tight = largeText ? UmiSpacing.xs : UmiSpacing.sm;
    final error = _tooShort
        ? l.operatorPinLength
        : _pinError(l, widget.controller.state.errorCode);
    // Touch-first PIN entry: a numeric keypad with large targets, not a text
    // field that would summon the OS keyboard on a counter tablet. The physical
    // keyboard still works through the KeyboardListener (dev, accessibility).
    return _EntryFrame(
      showSignature: false,
      child: KeyboardListener(
        focusNode: focus,
        autofocus: true,
        onKeyEvent: _onKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              container: true,
              header: true,
              child: Text(
                l.operatorPinTitle,
                style: PosTheme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
            ),
            SizedBox(height: block),
            Semantics(
              container: true,
              liveRegion: true,
              label: es ? 'PIN de operador' : 'Operator PIN',
              value: es ? '$length dígitos' : '$length digits',
              excludeSemantics: true,
              child: PinDots(length: length, minLength: 4),
            ),
            SizedBox(height: tight),
            Text(
              l.operatorPinHint,
              textAlign: TextAlign.center,
              style: PosTheme.of(context).textTheme.bodySmall,
            ),
            if (error != null) ...[
              SizedBox(height: tight),
              Text(
                error,
                textAlign: TextAlign.center,
                style: PosTheme.of(context).textTheme.bodyMedium?.copyWith(
                  color: PosTheme.of(context).colorScheme.error,
                ),
              ),
            ],
            SizedBox(height: block),
            PinPad(
              onDigit: (digit) => _press(digit),
              onBackspace: () => _press('back'),
              onClear: () => _press('clear'),
              canEdit: length > 0,
              es: es,
              // 60 px is still a long way above the till's 48 px floor, and it is the room that
              // keeps the action on the screen at 200 % text. The keys are the biggest thing on
              // this screen after the type itself, so they are the honest place to take it from.
              keyHeight: largeText ? 60 : 68,
              rowGap: largeText ? UmiSpacing.xs : UmiSpacing.sm,
            ),
            SizedBox(height: block),
            SizedBox(
              width: double.infinity,
              child: PosButton(
                onPressed: length >= 4 ? _submit : null,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: UmiSpacing.sm),
                  child: Text(l.operatorPinAction),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Applies one keypad action to the backing [pin] controller. A digit appends
  /// up to the 8-digit ceiling; `back` drops the last digit; `clear` empties.
  void _press(String key) {
    setState(() {
      _tooShort = false;
      if (key == 'back') {
        if (pin.text.isNotEmpty) {
          pin.text = pin.text.substring(0, pin.text.length - 1);
        }
      } else if (key == 'clear') {
        pin.clear();
      } else if (pin.text.length < 8) {
        pin.text = pin.text + key;
      }
    });
  }

  void _onKey(KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) return;
    final character = event.character;
    if (character != null &&
        character.length == 1 &&
        '0123456789'.contains(character)) {
      _press(character);
      return;
    }
    if (event.logicalKey == LogicalKeyboardKey.backspace ||
        event.logicalKey == LogicalKeyboardKey.delete) {
      _press('back');
      return;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter ||
        event.logicalKey == LogicalKeyboardKey.numpadEnter) {
      if (pin.text.length >= 4) _submit();
    }
  }

  void _submit() {
    if (pin.text.length < 4) {
      setState(() => _tooShort = true);
      return;
    }
    setState(() => _tooShort = false);
    widget.controller.loginWithPin(pin.text);
  }
}

String? _pinError(AppLocalizations l, String? code) => switch (code) {
  'PIN_LOCKED' => l.operatorPinLocked,
  'RATE_LIMITED' => l.operatorPinRateLimited,
  'ENTITLEMENT_DISABLED' => l.operatorPinEntitlementDisabled,
  'BRANCH_NOT_FOUND' => l.operatorPinBranchInvalid,
  'PERMISSION_DENIED' => l.operatorPinInvalid,
  _ => null,
};

final class _LoginState extends State<_Login> {
  final username = TextEditingController();
  final password = TextEditingController();
  @override
  void dispose() {
    username.dispose();
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return _EntryFrame(
      child: AutofillGroup(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              l.loginTitle,
              style: PosTheme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: UmiSpacing.lg),
            PosField(
              controller: username,
              autofillHints: const [AutofillHints.username],
              keyboardType: TextInputType.emailAddress,
              decoration: PosFieldDecoration(labelText: l.usernameLabel),
            ),
            const SizedBox(height: UmiSpacing.md),
            PosField(
              controller: password,
              autofillHints: const [AutofillHints.password],
              obscureText: true,
              enableSuggestions: false,
              autocorrect: false,
              decoration: PosFieldDecoration(labelText: l.passwordLabel),
              onSubmitted: (_) =>
                  widget.controller.login(username.text, password.text),
            ),
            const SizedBox(height: UmiSpacing.lg),
            PosButton(
              onPressed: () =>
                  widget.controller.login(username.text, password.text),
              child: Text(l.signInAction),
            ),
          ],
        ),
      ),
    );
  }
}

final class _TenantSelection extends StatelessWidget {
  const _TenantSelection({required this.controller});
  final EntryController controller;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    if (controller.state.merchants.isEmpty) {
      return StatusCard(
        icon: PosGlyphs.domainDisabledOutlined,
        title: l.noTenantTitle,
        message: l.noTenantBody,
      );
    }
    return _EntryFrame(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            l.selectTenantTitle,
            style: PosTheme.of(context).textTheme.headlineSmall,
          ),
          for (final tenant in controller.state.merchants)
            PosListRow(
              title: Text(tenant.name),
              trailing: const PosIcon(PosGlyphs.chevronRight),
              onTap: () => controller.selectTenant(tenant),
            ),
        ],
      ),
    );
  }
}

final class _BranchSelection extends StatelessWidget {
  const _BranchSelection({required this.controller});
  final EntryController controller;
  @override
  Widget build(BuildContext context) {
    final tenant = controller.state.selectedTenant;
    final l = AppLocalizations.of(context);
    final locations =
        tenant?.locations
            .map(LocationAccess.fromJson)
            .where(
              (b) =>
                  b.deviceAllowed && b.operatorAllowed && b.status == 'active',
            )
            .toList() ??
        [];
    return _EntryFrame(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            l.selectBranchTitle,
            style: PosTheme.of(context).textTheme.headlineSmall,
          ),
          if (locations.isEmpty) Text(l.noBranchBody),
          for (final branch in locations)
            PosListRow(
              title: Text(branch.name),
              trailing: const PosIcon(PosGlyphs.chevronRight),
              onTap: () => controller.selectBranch(tenant!, branch),
            ),
        ],
      ),
    );
  }
}

final class _OperatorEntry extends StatelessWidget {
  const _OperatorEntry({required this.controller});
  final EntryController controller;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return StatusCard(
      icon: PosGlyphs.badgeOutlined,
      title: l.operatorTitle,
      message: controller.state.errorCode == null
          ? l.operatorBody
          : operatorErrorMessage(context, controller.state.errorCode!),
      action: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          PosButton(
            onPressed: controller.startOperator,
            child: Text(l.startOperatorAction),
          ),
          if (controller.state.errorCode == 'OPERATOR_SESSION_BUSY') ...[
            const SizedBox(height: UmiSpacing.md),
            PosButton(
              onPressed: controller.logout,
              child: Text(l.logoutAction),
            ),
          ],
        ],
      ),
    );
  }
}

final class _ReadyShell extends StatelessWidget {
  const _ReadyShell({required this.controller});
  final EntryController controller;
  @override
  Widget build(BuildContext context) {
    final state = controller.state;
    final l = AppLocalizations.of(context);
    return PosPage(
      appBar: PosHeader(
        title: const Text('UmiPOS'),
        actions: [
          PosIconButton(
            tooltip: l.lockAction,
            onPressed: controller.lock,
            icon: const PosIcon(PosGlyphs.lockOutline),
          ),
          PosIconButton(
            tooltip: l.logoutAction,
            onPressed: controller.logout,
            icon: const PosIcon(PosGlyphs.logout),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: UmiSpacing.md,
                runSpacing: UmiSpacing.md,
                children: [
                  PosTag(label: Text(state.selectedTenant?.name ?? '—')),
                  PosTag(label: Text(state.selectedBranch?.name ?? '—')),
                  PosTag(label: Text(l.deviceActiveLabel)),
                  PosTag(label: Text(l.connectivityUnknownLabel)),
                ],
              ),
              const SizedBox(height: UmiSpacing.xl),
              Expanded(
                child: StatusCard(
                  icon: PosGlyphs.pointOfSaleOutlined,
                  title: l.shellReadyTitle,
                  message: l.catalogNotImplemented,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

final class _DeviceProblem extends StatelessWidget {
  const _DeviceProblem({required this.revoked});
  final bool revoked;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return PosPage(
      body: StatusCard(
        icon: PosGlyphs.phonelinkEraseOutlined,
        title: revoked ? l.deviceRevokedTitle : l.rotationRequiredTitle,
        message: revoked ? l.deviceRevokedBody : l.rotationRequiredBody,
      ),
    );
  }
}

final class _Recovery extends StatelessWidget {
  const _Recovery({required this.controller});
  final EntryController controller;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return PosPage(
      body: StatusCard(
        icon: PosGlyphs.cloudOffOutlined,
        title: controller.state.phase == EntryPhase.storageFailure
            ? l.storageUnavailableTitle
            : l.recoverableFailureTitle,
        message: controller.state.phase == EntryPhase.storageFailure
            ? l.storageUnavailableBody
            : l.recoverableNetworkBody,
        action: PosButton(
          onPressed: controller.initialize,
          child: Text(l.retryAction),
        ),
      ),
    );
  }
}

final class _EntryFrame extends StatelessWidget {
  const _EntryFrame({
    required this.child,
    this.showSignature = true,
    this.wordmarkOnly = false,
  });
  final Widget child;

  /// False on the PIN screen, where the keypad is the whole task and the
  /// terminal's own name would only take room above it.
  final bool showSignature;
  final bool wordmarkOnly;
  @override
  Widget build(BuildContext context) => PosPage(
    body: SafeArea(
      child: LayoutBuilder(
        builder: (context, size) {
          // `Muy grande` is a text scale of 2, and 16 x 2 = 32. At that size the entry screens
          // tighten their RHYTHM, never their content: the wordmark stays on loading screens
          // (a test pins that at 200 % — `entry loading retains context at enlarged phone scale`), the keypad keeps its
          // 68 px keys, and the spars that were decorative are what give way. The PIN screen is the
          // one exception, and shows no signature at all: the keypad is its whole task. Measured on
          // the iMin's 1014 px window: with the old rhythm the sign-in action sat 49 px below the
          // fold at 200 % (apps/umi-pos/test/device_pairing_test.dart, "the sign-in action stays on
          // screen at 200 % text").
          final largeText = MediaQuery.textScalerOf(context).scale(16) >= 24;
          final wide =
              size.maxWidth >= 1000 && size.maxHeight >= 600 && !largeText;
          final afterSignature = largeText ? UmiSpacing.md : UmiSpacing.xl;
          final formPadding = largeText
              ? UmiSpacing.sm
              : (size.maxWidth < 600 ? 12.0 : UmiSpacing.lg);
          final form = Center(
            child: SingleChildScrollView(
              // At the largest text the outer margin is the first thing to spend: the screens
              // keep every word and every key, and the room comes from the space around them.
              padding: EdgeInsets.all(
                largeText ? UmiSpacing.sm : UmiSpacing.lg,
              ),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: Padding(
                  padding: EdgeInsets.all(formPadding),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (showSignature) ...[
                        StationSignature(wordmarkOnly: wordmarkOnly),
                        SizedBox(height: afterSignature),
                      ],
                      child,
                    ],
                  ),
                ),
              ),
            ),
          );
          // Keep the form in one keyed row. Keyboard resize can hide the cover
          // without replacing the editor and its focus node.
          return Row(
            children: [
              if (wide)
                const Expanded(
                  key: ValueKey('entry-cover'),
                  flex: 5,
                  child: StationEntryCover(),
                ),
              Expanded(key: const ValueKey('entry-form'), flex: 7, child: form),
            ],
          );
        },
      ),
    ),
  );
}

/// True while a loading screen belongs to the operator's PIN: the screen that
/// verifies it and the screen that starts the session it opens.
bool _pinLoading(EntryPhase phase) =>
    phase == EntryPhase.pinAuthenticating ||
    phase == EntryPhase.startingOperator;

final class _EntryLoading extends StatelessWidget {
  const _EntryLoading({required this.phase});
  final EntryPhase phase;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final title = switch (phase) {
      EntryPhase.checkingDevice => l.entryCheckingTerminal,
      EntryPhase.restoringSession => l.entryRestoringSession,
      EntryPhase.authenticating => l.entryAuthenticating,
      EntryPhase.pinAuthenticating => l.entryVerifyingPin,
      _ => l.entryStartingOperator,
    };
    return _EntryFrame(
      // The PIN is one task from the keypad to the session it starts, and the
      // owner asked on 2026-10-11 for the terminal's own mark to stay off that
      // whole path: the mark, the word and the promise all read as one thing,
      // and they came back on the screen that follows the PIN.
      showSignature: !_pinLoading(phase),
      wordmarkOnly: true,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          PosSpinner(semanticsLabel: title),
          const SizedBox(height: UmiSpacing.lg),
          Text(
            title,
            textAlign: TextAlign.center,
            style: PosTheme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Text(l.entryLoadingBody, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}
