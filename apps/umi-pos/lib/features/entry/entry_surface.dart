import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:umi_contract/umi_contract.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/status_card.dart';
import 'entry_controller.dart';

final class EntrySurface extends StatelessWidget {
  const EntrySurface({required this.controller, super.key});
  final EntryController controller;
  @override
  Widget build(BuildContext context) => switch (controller.state.phase) {
    EntryPhase.checkingDevice ||
    EntryPhase.authenticating ||
    EntryPhase.pinAuthenticating ||
    EntryPhase.startingOperator => const Center(
      child: CircularProgressIndicator(),
    ),
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
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            l.enrollmentTitle,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Text(l.enrollmentBody, textAlign: TextAlign.center),
          const SizedBox(height: UmiSpacing.lg),
          TextField(
            controller: code,
            decoration: InputDecoration(
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
            child: ElevatedButton(
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
      child: Semantics(
        liveRegion: true,
        label: l.enrollmentPendingTitle,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: UmiSpacing.lg),
            Text(
              l.enrollmentPendingTitle,
              style: Theme.of(context).textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: UmiSpacing.sm),
            Text(l.enrollmentPendingBody, textAlign: TextAlign.center),
            const SizedBox(height: UmiSpacing.sm),
            Text(
              l.enrollmentPendingSecure,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (controller.state.errorCode != null) ...[
              const SizedBox(height: UmiSpacing.md),
              Text(l.recoverableNetworkBody, textAlign: TextAlign.center),
              const SizedBox(height: UmiSpacing.sm),
              OutlinedButton(
                onPressed: controller.retryPairing,
                child: Text(l.retryAction),
              ),
            ],
            const SizedBox(height: UmiSpacing.lg),
            TextButton(
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
    final error = _tooShort
        ? l.operatorPinLength
        : _pinError(l, widget.controller.state.errorCode);
    // Touch-first PIN entry: a numeric keypad with large targets, not a text
    // field that would summon the OS keyboard on a counter tablet. The physical
    // keyboard still works through the KeyboardListener (dev, accessibility).
    return _EntryFrame(
      child: KeyboardListener(
        focusNode: focus,
        autofocus: true,
        onKeyEvent: _onKey,
        child: Semantics(
          label: l.operatorPinTitle,
          value: es ? '$length dígitos' : '$length digits',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.dialpad_outlined, size: 44),
              const SizedBox(height: UmiSpacing.md),
              Text(
                l.operatorPinTitle,
                style: Theme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: UmiSpacing.sm),
              Text(l.operatorPinBody, textAlign: TextAlign.center),
              const SizedBox(height: UmiSpacing.lg),
              _PinDots(length: length, minLength: 4),
              const SizedBox(height: UmiSpacing.sm),
              Text(
                l.operatorPinHint,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (error != null) ...[
                const SizedBox(height: UmiSpacing.sm),
                Text(
                  error,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.error,
                  ),
                ),
              ],
              const SizedBox(height: UmiSpacing.lg),
              _PinPad(
                onDigit: (digit) => _press(digit),
                onBackspace: () => _press('back'),
                onClear: () => _press('clear'),
                canEdit: length > 0,
                es: es,
              ),
              const SizedBox(height: UmiSpacing.lg),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: length >= 4 ? _submit : null,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: UmiSpacing.sm,
                    ),
                    child: Text(l.operatorPinAction),
                  ),
                ),
              ),
            ],
          ),
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

/// A masked progress indicator for the PIN: one filled dot per entered digit,
/// with at least [minLength] outlined slots so the operator sees the 4-digit
/// floor. It never renders the digits themselves.
final class _PinDots extends StatelessWidget {
  const _PinDots({required this.length, required this.minLength});
  final int length;
  final int minLength;
  @override
  Widget build(BuildContext context) {
    final slots = length < minLength ? minLength : length;
    final scheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < slots; i++)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Container(
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i < length ? scheme.primary : Colors.transparent,
                border: Border.all(
                  color: i < length ? scheme.primary : scheme.outlineVariant,
                  width: 2,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// The 3×4 numeric keypad: digits 1-9, then clear · 0 · backspace.
final class _PinPad extends StatelessWidget {
  const _PinPad({
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
    required this.canEdit,
    required this.es,
  });
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;
  final bool canEdit;
  final bool es;
  @override
  Widget build(BuildContext context) => GridView.count(
    crossAxisCount: 3,
    shrinkWrap: true,
    physics: const NeverScrollableScrollPhysics(),
    mainAxisSpacing: UmiSpacing.sm,
    crossAxisSpacing: UmiSpacing.sm,
    childAspectRatio: 1.7,
    children: [
      for (final digit in const ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
        _PinKey(label: digit, onTap: () => onDigit(digit)),
      _PinKey(
        icon: Icons.close,
        semanticLabel: es ? 'Borrar todo' : 'Clear all',
        onTap: canEdit ? onClear : null,
        emphasized: false,
      ),
      _PinKey(label: '0', onTap: () => onDigit('0')),
      _PinKey(
        icon: Icons.backspace_outlined,
        semanticLabel: es ? 'Borrar' : 'Backspace',
        onTap: canEdit ? onBackspace : null,
        emphasized: false,
      ),
    ],
  );
}

/// One keypad key. A large, fixed target (fills its grid cell, ≥64dp tall).
final class _PinKey extends StatelessWidget {
  const _PinKey({
    this.label,
    this.icon,
    this.semanticLabel,
    required this.onTap,
    this.emphasized = true,
  });
  final String? label;
  final IconData? icon;
  final String? semanticLabel;
  final VoidCallback? onTap;
  final bool emphasized;
  @override
  Widget build(BuildContext context) {
    final child = icon != null
        ? Icon(icon, size: 26)
        : Text(label!, style: Theme.of(context).textTheme.headlineSmall);
    return Semantics(
      button: true,
      label: semanticLabel ?? label,
      child: SizedBox.expand(
        child: emphasized
            ? FilledButton.tonal(onPressed: onTap, child: child)
            : OutlinedButton(onPressed: onTap, child: child),
      ),
    );
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
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: UmiSpacing.lg),
            TextField(
              controller: username,
              autofillHints: const [AutofillHints.username],
              keyboardType: TextInputType.emailAddress,
              decoration: InputDecoration(labelText: l.usernameLabel),
            ),
            const SizedBox(height: UmiSpacing.md),
            TextField(
              controller: password,
              autofillHints: const [AutofillHints.password],
              obscureText: true,
              enableSuggestions: false,
              autocorrect: false,
              decoration: InputDecoration(labelText: l.passwordLabel),
              onSubmitted: (_) =>
                  widget.controller.login(username.text, password.text),
            ),
            const SizedBox(height: UmiSpacing.lg),
            ElevatedButton(
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
        icon: Icons.domain_disabled_outlined,
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
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          for (final tenant in controller.state.merchants)
            ListTile(
              title: Text(tenant.name),
              trailing: const Icon(Icons.chevron_right),
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
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          if (locations.isEmpty) Text(l.noBranchBody),
          for (final branch in locations)
            ListTile(
              title: Text(branch.name),
              trailing: const Icon(Icons.chevron_right),
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
      icon: Icons.badge_outlined,
      title: l.operatorTitle,
      message: l.operatorBody,
      action: ElevatedButton(
        onPressed: controller.startOperator,
        child: Text(l.startOperatorAction),
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
    return Scaffold(
      appBar: AppBar(
        title: const Text('UmiPOS'),
        actions: [
          IconButton(
            tooltip: l.lockAction,
            onPressed: controller.lock,
            icon: const Icon(Icons.lock_outline),
          ),
          IconButton(
            tooltip: l.logoutAction,
            onPressed: controller.logout,
            icon: const Icon(Icons.logout),
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
                  Chip(label: Text(state.selectedTenant?.name ?? '—')),
                  Chip(label: Text(state.selectedBranch?.name ?? '—')),
                  Chip(label: Text(l.deviceActiveLabel)),
                  Chip(label: Text(l.connectivityUnknownLabel)),
                ],
              ),
              const SizedBox(height: UmiSpacing.xl),
              Expanded(
                child: StatusCard(
                  icon: Icons.point_of_sale_outlined,
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
    return StatusCard(
      icon: Icons.phonelink_erase_outlined,
      title: revoked ? l.deviceRevokedTitle : l.rotationRequiredTitle,
      message: revoked ? l.deviceRevokedBody : l.rotationRequiredBody,
    );
  }
}

final class _Recovery extends StatelessWidget {
  const _Recovery({required this.controller});
  final EntryController controller;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return StatusCard(
      icon: Icons.cloud_off_outlined,
      title: l.recoverableFailureTitle,
      message: l.recoverableNetworkBody,
      action: ElevatedButton(
        onPressed: controller.initialize,
        child: Text(l.retryAction),
      ),
    );
  }
}

final class _EntryFrame extends StatelessWidget {
  const _EntryFrame({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(UmiSpacing.xl),
                child: child,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
