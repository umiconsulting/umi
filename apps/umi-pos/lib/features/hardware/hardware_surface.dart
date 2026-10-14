import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/security/operator_permissions.dart';
import '../../shared/widgets/station_document.dart';
import '../entry/entry_controller.dart';
import 'hardware_service.dart';
import 'terminal_cashbox_transport.dart';
import 'usb_printer_transport.dart';

/// Folds a newer reading into the runtime a screen shows.
///
/// The device rows of [shown] stay, because a reading may carry only the devices
/// that are active. The newer measured state of each device replaces the older one,
/// and the print queue becomes the newer queue. Everything else stays as the screen
/// loaded it.
HardwareRuntimeSnapshot adoptHardwareReading({
  required HardwareRuntimeSnapshot shown,
  required HardwareRuntimeSnapshot reading,
}) {
  final measured = <String, Object?>{};
  for (final device in reading.devices) {
    final id = device['id'];
    if (id is String) measured[id] = device['connectionState'];
  }
  return HardwareRuntimeSnapshot.fromJson({
    ...shown.toJson(),
    'devices': shown.devices.map((device) {
      final id = device['id'];
      final state = id is String ? measured[id] : null;
      if (state is! String) return device;
      return {...device, 'connectionState': state};
    }).toList(),
    'printJobs': reading.printJobs ?? shown.printJobs,
    'pendingJobs': reading.pendingJobs,
    'retryableJobs': reading.retryableJobs,
    'unknownCommands': reading.unknownCommands,
    'capturedAt': reading.capturedAt,
  });
}

Future<void> showHardwareCenter(
  BuildContext context, {
  required EntryController entry,
  required HardwareService service,
  required OperatorPermissions permissions,
  required String? registerId,
}) => showPosSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (_) => FractionallySizedBox(
    heightFactor: .9,
    child: HardwareSurface(
      entry: entry,
      service: service,
      permissions: permissions,
      registerId: registerId,
    ),
  ),
);

final class HardwareSurface extends StatefulWidget {
  const HardwareSurface({
    required this.entry,
    required this.service,
    required this.permissions,
    required this.registerId,
    super.key,
  });

  final EntryController entry;
  final HardwareService service;
  final OperatorPermissions permissions;
  final String? registerId;

  @override
  State<HardwareSurface> createState() => _HardwareSurfaceState();
}

final class _HardwareSurfaceState extends State<HardwareSurface> {
  HardwareRuntimeSnapshot? _snapshot;
  String? _error;
  bool _busy = false;

  HardwareScope? get _scope {
    final state = widget.entry.state;
    final merchant = state.selectedTenant;
    final location = state.selectedBranch;
    final operator = state.operator;
    final posDevice = state.device;
    if (merchant == null ||
        location == null ||
        operator == null ||
        posDevice == null) {
      return null;
    }
    return HardwareScope(
      merchantId: merchant.id,
      locationId: location.id,
      operatorSessionId: operator.id,
      deviceId: posDevice.id,
      credentialVersion: posDevice.credentialVersion,
      permissions: operator.permissions.toSet(),
      registerId: widget.registerId,
    );
  }

  bool get _spanish => Localizations.localeOf(context).languageCode == 'es';
  String text(String english, String spanish) => _spanish ? spanish : english;

  @override
  void initState() {
    super.initState();
    widget.service.latestRuntime.addListener(_adoptReading);
    // The operator is looking at the hardware, so the relay keeps the fast cadence
    // while this screen is on.
    widget.service.watchRuntime();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    widget.service.latestRuntime.removeListener(_adoptReading);
    widget.service.unwatchRuntime();
    super.dispose();
  }

  /// Shows a reading the till made while this screen was open.
  ///
  /// The relay reads the hardware runtime every ten seconds while an operator
  /// session is open, so this screen stays current without one request of its own.
  /// A reading for another register is not this screen's business and is ignored.
  void _adoptReading() {
    final reading = widget.service.latestRuntime.value;
    final shown = _snapshot;
    final scope = _scope;
    if (!mounted || reading == null || shown == null || scope == null) return;
    if (reading.merchantId != scope.merchantId ||
        reading.locationId != scope.locationId ||
        reading.registerId != scope.registerId) {
      return;
    }
    setState(
      () => _snapshot = adoptHardwareReading(shown: shown, reading: reading),
    );
  }

  Future<void> _load() async {
    final scope = _scope;
    if (scope == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final snapshot = await widget.service.snapshot(
        scope,
        includeDisabled: widget.permissions.allows('hardware.manage'),
      );
      if (mounted) setState(() => _snapshot = snapshot);
    } catch (_) {
      if (mounted) setState(() => _error = 'hardware_load_failed');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = _snapshot;
    return PosPage(
      appBar: PosHeader(
        title: StationHeading(
          title: text('Hardware center', 'Centro de hardware'),
        ),
        actions: [
          PosIconButton(
            tooltip: text('Refresh hardware', 'Actualizar hardware'),
            onPressed: _busy ? null : _load,
            icon: const PosIcon(PosGlyphs.refresh),
          ),
          PosIconButton(
            tooltip: text('Close', 'Cerrar'),
            onPressed: () => Navigator.pop(context),
            icon: const PosIcon(PosGlyphs.close),
          ),
        ],
      ),
      body: SafeArea(
        child: _busy && snapshot == null
            ? const Center(child: PosSpinner())
            : _error != null
            ? Center(
                child: Semantics(
                  liveRegion: true,
                  child: Text(
                    text(
                      'Hardware data is unavailable.',
                      'Los datos de hardware no están disponibles.',
                    ),
                  ),
                ),
              )
            : _content(snapshot),
      ),
    );
  }

  Widget _content(HardwareRuntimeSnapshot? snapshot) {
    final devices = (snapshot?.devices ?? const [])
        .map(HardwareDevice.fromJson)
        .toList();
    final jobs = (snapshot?.printJobs ?? const [])
        .map(PrintJob.fromJson)
        .toList();
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Semantics(
          header: true,
          child: Text(
            text('Assigned devices', 'Dispositivos asignados'),
            style: PosTheme.of(context).textTheme.titleLarge,
          ),
        ),
        if (widget.permissions.allows('hardware.manage'))
          Wrap(
            spacing: 8,
            children: [
              // One tap: look on the till's own USB host port, then add whatever
              // printer answers. The cable is the configuration, so the operator
              // never picks a host, a port, or a transport.
              PosButton.icon(
                onPressed: _busy ? null : _addUsbPrinter,
                icon: const PosIcon(PosGlyphs.usb),
                label: Text(text('Find USB printer', 'Buscar impresora USB')),
              ),
              // The drawer's other cable, in one tap: the terminal is asked
              // whether it has its own cashbox port, and a record is filed only
              // when it answers. A tablet gets a sentence instead of a device
              // row that could never open anything.
              PosButton.icon(
                onPressed: _busy ? null : _addTerminalDrawer,
                icon: const PosIcon(PosGlyphs.pointOfSaleOutlined),
                label: Text(
                  text('Find terminal drawer', 'Buscar cajón de la terminal'),
                ),
              ),
              PosButton.icon(
                onPressed: _busy ? null : _register,
                icon: const PosIcon(PosGlyphs.add),
                label: Text(text('Register device', 'Registrar dispositivo')),
              ),
            ],
          ),
        const SizedBox(height: 8),
        if (devices.isEmpty)
          Text(text('No assigned hardware.', 'No hay hardware asignado.')),
        ...devices.map(_deviceCard),
        const SizedBox(height: 24),
        Semantics(
          header: true,
          child: Text(
            text('Printer queue', 'Cola de impresión'),
            style: PosTheme.of(context).textTheme.titleLarge,
          ),
        ),
        if (jobs.isEmpty)
          Text(text('The queue is empty.', 'La cola está vacía.')),
        // NEWEST FIRST. The API reads the queue in creation order, which is right for a
        // dispatcher and wrong for the person who just pressed "Run test": the page they
        // asked for landed at the bottom of a scrolling list, off screen, so a working
        // button looked like a broken one. On the pilot till this was the second half of
        // "Ejecutar prueba no funciona" — the first was the command being refused.
        ...jobs.reversed.map(_jobTile),
        if ((snapshot?.unknownCommands ?? 0) > 0)
          Semantics(
            liveRegion: true,
            child: Text(
              text(
                'A hardware result requires physical verification.',
                'Un resultado de hardware requiere verificación física.',
              ),
            ),
          ),
        if ((snapshot?.recoveryStates ?? const []).contains('drawer_unknown') &&
            widget.permissions.allows('hardware.drawer.test') &&
            devices.where((device) => device.type == 'cash_drawer').isNotEmpty)
          PosButton.tonalIcon(
            onPressed: _busy
                ? null
                : () => _diagnostic(
                    devices.firstWhere(
                      (device) => device.type == 'cash_drawer',
                    ),
                  ),
            icon: const PosIcon(PosGlyphs.pointOfSaleOutlined),
            label: Text(
              text(
                'Issue authorized second open',
                'Emitir segunda apertura autorizada',
              ),
            ),
          ),
      ],
    );
  }

  Widget _deviceCard(HardwareDevice device) => PosCard(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${_deviceType(device.type)} · ${device.publicReference}',
                  style: PosTheme.of(context).textTheme.titleMedium,
                ),
              ),
              Semantics(
                label: device.enabled
                    ? _unverifiedTerminalDrawer(device)
                          ? text(
                              'Terminal port available; physical drawer unverified',
                              'Puerto de la terminal disponible; cajón físico sin verificar',
                            )
                          : text('Device enabled', 'Dispositivo activo')
                    : text('Device disabled', 'Dispositivo inactivo'),
                child: PosIcon(
                  !device.enabled
                      ? PosGlyphs.block
                      : _unverifiedTerminalDrawer(device)
                      ? PosGlyphs.helpOutline
                      : PosGlyphs.checkCircle,
                  color: device.enabled && !_unverifiedTerminalDrawer(device)
                      ? PosColors.green
                      : PosColors.grey,
                ),
              ),
            ],
          ),
          Text('${device.manufacturer} ${device.model}'),
          Text('${text('Connection', 'Conexión')}: ${_connection(device)}'),
          Wrap(
            spacing: 8,
            children: [
              if (_canTest(device))
                PosOutlineButton.icon(
                  onPressed: _busy ? null : () => _diagnostic(device),
                  icon: const PosIcon(PosGlyphs.healthAndSafetyOutlined),
                  label: Text(text('Run test', 'Ejecutar prueba')),
                ),
              if (widget.permissions.allows('hardware.manage'))
                PosOutlineButton.icon(
                  onPressed: _busy
                      ? null
                      : device.type == 'printer'
                      ? () => _configurePrinter()
                      : () => _configureConnection(device),
                  icon: const PosIcon(PosGlyphs.settingsOutlined),
                  label: Text(
                    device.type == 'printer'
                        ? text('Printer settings', 'Ajustes de impresora')
                        : text('Configure', 'Configurar'),
                  ),
                ),
              if (device.type == 'printer' &&
                  {
                    'network_tcp',
                    'printer_attached',
                  }.contains(device.transport) &&
                  widget.permissions.allows('hardware.manage'))
                PosOutlineButton.icon(
                  onPressed: _busy ? null : () => _configureConnection(device),
                  icon: const PosIcon(PosGlyphs.tuneOutlined),
                  label: Text(text('Connection', 'Conexión')),
                ),
              if (widget.permissions.allows('hardware.assign') &&
                  (device.registerId != widget.registerId ||
                      device.assignedPosDeviceId !=
                          widget.entry.state.device?.id ||
                      (device.type == 'printer' && device.primary != true)))
                PosOutlineButton.icon(
                  onPressed: _busy ? null : () => _assignHere(device),
                  icon: const PosIcon(PosGlyphs.assignmentTurnedInOutlined),
                  label: Text(
                    device.type == 'printer'
                        ? text('Use as primary', 'Usar como principal')
                        : text('Assign here', 'Asignar aquí'),
                  ),
                ),
              if (widget.permissions.allows('hardware.manage'))
                PosOutlineButton.icon(
                  onPressed: _busy ? null : () => _toggle(device),
                  icon: PosIcon(
                    device.enabled ? PosGlyphs.pause : PosGlyphs.playArrow,
                  ),
                  label: Text(
                    device.enabled
                        ? text('Disable', 'Desactivar')
                        : text('Enable', 'Activar'),
                  ),
                ),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _jobTile(PrintJob job) => PosListRow(
    leading: const PosIcon(PosGlyphs.printOutlined),
    title: Text('${_jobType(job.type)} · ${job.sourceAggregateId}'),
    subtitle: Text(_jobStatus(job.status)),
    trailing:
        job.status == 'retryable_failure' &&
            widget.permissions.allows('hardware.printer.print')
        ? PosTextButton(
            onPressed: _busy ? null : () => _retry(job),
            child: Text(text('Retry', 'Reintentar')),
          )
        // A test page is re-run from "Run test", not copied: a copy carries a
        // sale's identity, and a test page has none.
        : job.type != 'test_page' &&
              widget.permissions.allows('hardware.printer.reprint') &&
              {
                'printed',
                'terminal_failure',
                'unknown_outcome',
              }.contains(job.status)
        ? PosTextButton(
            onPressed: _busy ? null : () => _reprint(job),
            child: Text(text('Controlled reprint', 'Reimpresión controlada')),
          )
        : null,
  );

  bool _canTest(HardwareDevice device) =>
      widget.permissions.allows(switch (device.type) {
        'printer' => 'hardware.printer.test',
        'cash_drawer' => 'hardware.drawer.test',
        'barcode_scanner' => 'hardware.scanner.test',
        'customer_display' => 'hardware.customer_display.test',
        _ => 'hardware.diagnostics',
      });

  Future<void> _diagnostic(HardwareDevice device) async {
    final scope = _scope;
    if (scope == null) return;
    setState(() => _busy = true);
    try {
      final result = await widget.service.runDiagnostic(
        scope: scope,
        hardwareId: device.id,
        diagnostic: switch (device.type) {
          'printer' => 'printer_test_page',
          'cash_drawer' => 'drawer_test',
          'barcode_scanner' => 'scanner_test_session',
          'customer_display' => 'customer_display_test',
          _ => 'connection_test',
        },
      );
      await _load();
      // SAY WHAT HAPPENED. The test page leaves the queue at the bottom and the paper
      // leaves the printer silently; without this line the operator has nothing to read
      // and concludes the button did nothing. The device is named because a till may hold
      // several, and the health is named because "sent" is not "printed".
      _snack(
        device.type == 'cash_drawer' &&
                device.transport == 'platform_channel_foundation' &&
                result.health == 'unknown' &&
                result.failure == null
            ? text(
                'The terminal accepted the pulse. Check that the drawer opened.',
                'La terminal aceptó el pulso. Verifica que el cajón haya abierto.',
              )
            : '${text('Test sent to', 'Prueba enviada a')} ${device.manufacturer} ${device.model}: '
                  '${_diagnosticHealth(result.health)}.',
      );
    } catch (_) {
      _failed(
        'The test did not reach the device.',
        'La prueba no llegó al dispositivo.',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The one-button path for a receipt printer on the till's USB host port.
  ///
  /// It discovers the printer instead of asking the operator to describe it:
  /// the printer that answers is the printer, so the link, the host, and the
  /// port are not questions. An Epson (Seiko) device wins when several
  /// printer-class devices are present, because that is the pilot's printer.
  Future<void> _addUsbPrinter() async {
    final scope = _scope;
    if (scope == null) return;
    setState(() => _busy = true);
    try {
      List<UsbPrinterInfo> printers;
      try {
        printers = await MethodChannelUsbPrinter().attached();
      } catch (_) {
        // No channel (desktop/test) or a platform fault: nothing was found.
        printers = const <UsbPrinterInfo>[];
      }
      if (printers.isEmpty) {
        _snack(
          text(
            'No USB printer found. Check the cable and try again.',
            'No se encontró una impresora USB. Revisa el cable e inténtalo de nuevo.',
          ),
        );
        return;
      }
      final found = printers.firstWhere(
        (printer) => printer.isEpson,
        orElse: () => printers.first,
      );
      final reference = _usbReference(found);
      final model = (found.productName?.trim().isNotEmpty ?? false)
          ? found.productName!.trim()
          : text('USB receipt printer', 'Impresora de recibos USB');
      // Adding the same printer twice is not an error: fall back to the record
      // already filed under this reference and just point it at this till.
      final device =
          _registeredWithReference(reference) ??
          await widget.service.registerDevice(
            scope: scope,
            assignedPosDeviceId: widget.entry.state.device?.id,
            type: 'printer',
            manufacturer: found.isEpson ? 'Epson' : 'Generic',
            model: model,
            publicReference: reference,
            transport: 'usb_foundation',
            capabilities: const [
              'printer.receipt',
              // THE HEAD CAN DRAW A PICTURE, AND THE TILL BELIEVES IT.
              //
              // This list is what the till registers a receipt printer with, and
              // `printer.image` gates the café's mark: without it the renderer is
              // never even asked to fetch the logo, so every ticket came out with
              // the name and no picture while the SAME receipt showed the mark on
              // screen (iMin D3-504, 2026-10-11). A receipt printer this product
              // talks to is an ESC/POS head, and the mark is a `GS v 0` raster —
              // the one command in the family that every one of them implements.
              'printer.image',
              'printer.qr',
              'printer.cut',
              'printer.test_page',
            ],
            connectionConfiguration: const {
              'connectTimeoutMs': 2000,
              'commandTimeoutMs': 5000,
              'characterEncoding': 'cp850',
              // The pilot printer is 80 mm: 48 columns at the printer's own
              // default font. The form default (42) is for 58 mm paper.
              'receiptWidthColumns': 48,
              'drawerPulsePin': 0,
              'drawerPulseOnMs': 50,
              'scannerTerminator': 'enter',
              'scannerBurstWindowMs': 80,
            },
          );
      await widget.service.assignDevice(
        scope: scope,
        hardwareId: device.id,
        assignedPosDeviceId: widget.entry.state.device?.id,
        primary: true,
        expectedVersion: device.optimisticVersion,
      );
      await _load();
      _snack(text('USB printer added.', 'Impresora USB agregada.'));
    } catch (_) {
      _snack(
        text(
          'The USB printer could not be added.',
          'No se pudo agregar la impresora USB.',
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// A stable, schema-legal public reference for a discovered USB device.
  String _usbReference(UsbPrinterInfo info) =>
      'usb-${info.vendorId.toRadixString(16).padLeft(4, '0')}'
      '-${info.productId.toRadixString(16).padLeft(4, '0')}';

  /// The one-button path for a drawer on the terminal's own RJ12 port.
  ///
  /// The terminal is asked whether it has the port before anything is filed: an
  /// iMin answers with the node it pulses and the drawer-detect reading, and a
  /// tablet answers nothing, so the operator reads a sentence instead of
  /// collecting a device row that could never open anything.
  Future<void> _addTerminalDrawer() async {
    final scope = _scope;
    if (scope == null) return;
    setState(() => _busy = true);
    try {
      TerminalCashboxAnswer answer;
      try {
        answer = await MethodChannelTerminalCashbox().probe();
      } catch (_) {
        answer = const TerminalCashboxAnswer(
          outcome: TerminalCashboxOutcome.absent,
          failureCode: 'transport_unavailable',
        );
      }
      final port = answer.port;
      if (answer.outcome != TerminalCashboxOutcome.ready || port == null) {
        _snack(
          text(
            'This terminal has no cash drawer port the app can reach.',
            'Esta terminal no tiene un puerto de cajón que la app pueda usar.',
          ),
        );
        return;
      }
      final reference = 'imin-cashbox:${port.node.split('/').last}';
      final device =
          _registeredWithReference(reference) ??
          await widget.service.registerDevice(
            scope: scope,
            assignedPosDeviceId: widget.entry.state.device?.id,
            type: 'cash_drawer',
            manufacturer: 'iMin',
            model: 'Terminal cash drawer port',
            publicReference: reference,
            transport: 'platform_channel_foundation',
            capabilities: const ['drawer.open', 'drawer.status'],
            connectionConfiguration: const {
              'connectTimeoutMs': 2000,
              'commandTimeoutMs': 5000,
              'characterEncoding': 'cp850',
              'receiptWidthColumns': 42,
              // The pin is the board's only cashbox line. The pulse WIDTH is the
              // board's too — the node takes a level, not a timing — so this is
              // kept as the registry's record and is not what the till sends.
              'drawerPulsePin': 0,
              'drawerPulseOnMs': 50,
              'scannerTerminator': 'enter',
              'scannerBurstWindowMs': 80,
            },
          );
      await widget.service.assignDevice(
        scope: scope,
        hardwareId: device.id,
        assignedPosDeviceId: widget.entry.state.device?.id,
        primary: true,
        expectedVersion: device.optimisticVersion,
      );
      await _load();
      _snack(
        text(
          'Terminal drawer port registered. Connect the drawer and verify that it opens.',
          'Puerto del cajón registrado. Conecta el cajón y verifica que abra.',
        ),
      );
    } catch (_) {
      _failed(
        'The cash drawer could not be added.',
        'No se pudo agregar el cajón.',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  HardwareDevice? _registeredWithReference(String reference) {
    for (final raw in _snapshot?.devices ?? const <Object>[]) {
      final device = HardwareDevice.fromJson(raw as Map<String, Object?>);
      if (device.publicReference == reference) return device;
    }
    return null;
  }

  void _snack(String message) {
    if (!mounted) return;
    showPosFeedback(context, message);
  }

  /// An action that failed says so in place. Swapping the whole surface for
  /// "hardware data is unavailable" threw away the list the operator was
  /// reading, so a refused reprint looked like an empty tab.
  void _failed(String english, String spanish) =>
      _snack(text(english, spanish));

  Future<void> _register() async {
    final scope = _scope;
    if (scope == null) return;
    final result = await showPosDialog<_HardwareDraft>(
      context: context,
      builder: (_) => _HardwareRegistrationDialog(spanish: _spanish),
    );
    if (result == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final device = await widget.service.registerDevice(
        scope: scope,
        assignedPosDeviceId: widget.entry.state.device?.id,
        type: result.type,
        manufacturer: result.manufacturer,
        model: result.model,
        publicReference: result.publicReference,
        transport: result.transport,
        capabilities: result.capabilities,
        connectionConfiguration: result.configuration,
      );
      await widget.service.assignDevice(
        scope: scope,
        hardwareId: device.id,
        assignedPosDeviceId: widget.entry.state.device?.id,
        primary: result.type == 'printer',
        expectedVersion: device.optimisticVersion,
      );
      await _load();
    } catch (_) {
      _failed(
        'The device was not registered.',
        'No se registró el dispositivo.',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _configureConnection(HardwareDevice device) async {
    if (!{'network_tcp', 'printer_attached'}.contains(device.transport)) return;
    final scope = _scope;
    if (scope == null) return;
    final current = device.connectionConfiguration ?? const {};
    final result = await showPosDialog<_NetworkDraft>(
      context: context,
      builder: (_) => _NetworkConfigurationDialog(
        spanish: _spanish,
        host: current['networkHost'] as String? ?? '',
        port: current['networkPort'] as int? ?? 9100,
      ),
    );
    if (result == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.service.updateDevice(
        scope: scope,
        hardwareId: device.id,
        enabled: device.enabled,
        expectedVersion: device.optimisticVersion,
        connectionConfiguration: {
          ...current,
          'networkHost': result.host,
          'networkPort': result.port,
        },
      );
      await _load();
    } catch (_) {
      _failed(
        'The configuration was not saved.',
        'No se guardó la configuración.',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _configurePrinter() async {
    final snapshot = _snapshot;
    if (snapshot == null) return;
    final scope = _scope;
    if (scope == null) return;
    final result = await showPosDialog<Map<String, Object?>>(
      context: context,
      builder: (_) => PrinterSettingsDialog(
        spanish: _spanish,
        initial: snapshot.policy ?? const {},
      ),
    );
    if (result == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.service.updatePolicy(
        scope: scope,
        expectedVersion: snapshot.policyVersion ?? 1,
        policy: result,
      );
      await _load();
    } catch (_) {
      _failed('The policy was not saved.', 'No se guardó la política.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggle(HardwareDevice device) async {
    final scope = _scope;
    if (scope == null) return;
    setState(() => _busy = true);
    try {
      await widget.service.updateDevice(
        scope: scope,
        hardwareId: device.id,
        enabled: !device.enabled,
        expectedVersion: device.optimisticVersion,
      );
      await _load();
    } catch (_) {
      _failed('The change was not saved.', 'No se guardó el cambio.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _assignHere(HardwareDevice device) async {
    final scope = _scope;
    if (scope == null) return;
    setState(() => _busy = true);
    try {
      await widget.service.assignDevice(
        scope: scope,
        hardwareId: device.id,
        assignedPosDeviceId: widget.entry.state.device?.id,
        primary: device.type == 'printer',
        expectedVersion: device.optimisticVersion,
      );
      await _load();
    } catch (_) {
      _failed(
        'The device was not assigned to this till.',
        'No se asignó el dispositivo a esta caja.',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reprint(PrintJob job) async {
    final scope = _scope;
    if (scope == null) return;
    setState(() => _busy = true);
    try {
      await widget.service.controlledReprint(
        scope: scope,
        jobId: job.jobId,
        reason: 'operator_verified_missing',
      );
      await _load();
    } catch (_) {
      _failed('The copy did not print.', 'La copia no se imprimió.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _retry(PrintJob job) async {
    final scope = _scope;
    if (scope == null) return;
    setState(() => _busy = true);
    try {
      await widget.service.retryKnownSafePrint(scope: scope, jobId: job.jobId);
      await _load();
    } catch (_) {
      _failed('The retry did not print.', 'El reintento no se imprimió.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _deviceType(String value) => switch (value) {
    'printer' => text('Printer', 'Impresora'),
    'cash_drawer' => text('Cash drawer', 'Cajón de efectivo'),
    'barcode_scanner' => text('Barcode scanner', 'Escáner de códigos'),
    'customer_display' => text('Customer display', 'Pantalla del cliente'),
    'payment_terminal_foundation' => text(
      'Payment terminal foundation',
      'Base de terminal de pago',
    ),
    'scale_foundation' => text('Scale foundation', 'Base de báscula'),
    _ => text('Hardware device', 'Dispositivo de hardware'),
  };

  String _connection(HardwareDevice device) {
    if (_unverifiedTerminalDrawer(device)) {
      return text(
        'Terminal port available; physical drawer unverified',
        'Puerto de la terminal disponible; cajón físico sin verificar',
      );
    }
    return switch (device.connectionState) {
      'connected' => text('Connected', 'Conectado'),
      'disconnected' => text('Disconnected', 'Desconectado'),
      'connecting' => text('Connecting', 'Conectando'),
      'busy' => text('Busy', 'Ocupado'),
      'error' => text('Error', 'Error'),
      _ => text('Unknown', 'Desconocido'),
    };
  }

  bool _unverifiedTerminalDrawer(HardwareDevice device) =>
      device.type == 'cash_drawer' &&
      device.transport == 'platform_channel_foundation' &&
      device.connectionState == 'unknown';

  /// The queue names the document, so a test page is not mistaken for a sale.
  String _jobType(String value) => switch (value) {
    'receipt_copy' => text('Receipt copy', 'Copia de recibo'),
    'test_page' => text('Test page', 'Página de prueba'),
    _ => text('Receipt', 'Recibo'),
  };

  /// What a finished diagnostic says about the device. "Sent" is not "printed": the
  /// command can come back healthy while the paper never moves, and the operator has to
  /// be able to tell those apart.
  String _diagnosticHealth(String value) => switch (value) {
    'healthy' => text('the device answered', 'el dispositivo respondió'),
    'degraded' => text(
      'the device answered slowly',
      'el dispositivo respondió con lentitud',
    ),
    'unavailable' => text(
      'the device did not answer',
      'el dispositivo no respondió',
    ),
    _ => text('no result from the device', 'sin resultado del dispositivo'),
  };
  String _jobStatus(String value) => switch (value) {
    'queued' => text('Queued', 'En cola'),
    'printing' => text('Printing', 'Imprimiendo'),
    'printed' => text('Printed', 'Impreso'),
    'retryable_failure' => text('Retry available', 'Reintento disponible'),
    'terminal_failure' => text('Action required', 'Se requiere una acción'),
    'cancelled' => text('Cancelled', 'Cancelado'),
    'unknown_outcome' => text(
      'Verify the physical receipt',
      'Verifica el recibo físico',
    ),
    _ => text('Unknown', 'Desconocido'),
  };
}

final class _HardwareDraft {
  const _HardwareDraft({
    required this.type,
    required this.manufacturer,
    required this.model,
    required this.publicReference,
    required this.transport,
    required this.capabilities,
    required this.configuration,
  });
  final String type;
  final String manufacturer;
  final String model;
  final String publicReference;
  final String transport;
  final List<String> capabilities;
  final Map<String, Object?> configuration;
}

final class _HardwareRegistrationDialog extends StatefulWidget {
  const _HardwareRegistrationDialog({required this.spanish});
  final bool spanish;

  @override
  State<_HardwareRegistrationDialog> createState() =>
      _HardwareRegistrationDialogState();
}

final class _HardwareRegistrationDialogState
    extends State<_HardwareRegistrationDialog> {
  final _form = GlobalKey<FormState>();
  final _manufacturer = TextEditingController(text: 'Generic');
  final _model = TextEditingController();
  final _reference = TextEditingController();
  final _host = TextEditingController();
  final _port = TextEditingController(text: '9100');
  String type = 'printer';
  bool simulator = false;
  // How the till reaches a printer or the drawer that hangs off it: over the
  // network, or on the till's own USB host port.
  String link = 'network';

  String t(String english, String spanish) =>
      widget.spanish ? spanish : english;

  @override
  void dispose() {
    _manufacturer.dispose();
    _model.dispose();
    _reference.dispose();
    _host.dispose();
    _port.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final needsNetwork =
        !simulator &&
        link == 'network' &&
        {'printer', 'cash_drawer'}.contains(type);
    final needsLink = !simulator && {'printer', 'cash_drawer'}.contains(type);
    return PosAlertDialog(
      title: Text(t('Register device', 'Registrar dispositivo')),
      content: Form(
        key: _form,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              PosSelectFormField<String>(
                initialValue: type,
                decoration: PosFieldDecoration(
                  labelText: t('Device type', 'Tipo de dispositivo'),
                ),
                items: [
                  PosSelectItem(
                    value: 'printer',
                    child: Text(t('Printer', 'Impresora')),
                  ),
                  PosSelectItem(
                    value: 'cash_drawer',
                    child: Text(t('Cash drawer', 'Cajón de efectivo')),
                  ),
                  PosSelectItem(
                    value: 'barcode_scanner',
                    child: Text(t('Barcode scanner', 'Escáner de códigos')),
                  ),
                  PosSelectItem(
                    value: 'customer_display',
                    child: Text(t('Customer display', 'Pantalla del cliente')),
                  ),
                ],
                onChanged: (value) => setState(() {
                  type = value ?? type;
                  // "Terminal port" is a drawer's answer only: a printer has no
                  // such socket, so a stale choice falls back to the network.
                  if (type == 'printer' && link == 'terminal') link = 'network';
                }),
              ),
              PosSwitchRow(
                value: simulator,
                onChanged: (value) => setState(() => simulator = value),
                title: Text(t('Use simulator', 'Usar simulador')),
              ),
              if (needsLink)
                PosSelectFormField<String>(
                  initialValue: link,
                  decoration: PosFieldDecoration(
                    labelText: t('Connection', 'Conexión'),
                  ),
                  items: [
                    PosSelectItem(
                      value: 'network',
                      child: Text(t('Network', 'Red')),
                    ),
                    PosSelectItem(
                      value: 'usb',
                      child: Text(t('USB (till port)', 'USB (puerto del POS)')),
                    ),
                    // The drawer's OTHER cable: the RJ11 socket on the terminal
                    // itself. An iMin carries that port, and the pulse is not a
                    // printer's ESC/POS byte, so it is a different transport.
                    if (type == 'cash_drawer')
                      PosSelectItem(
                        value: 'terminal',
                        child: Text(
                          t(
                            'Terminal port (iMin RJ11)',
                            'Puerto de la terminal (RJ11 iMin)',
                          ),
                        ),
                      ),
                  ],
                  onChanged: (value) => setState(() => link = value ?? link),
                ),
              PosFormField(
                controller: _manufacturer,
                decoration: PosFieldDecoration(
                  labelText: t('Manufacturer', 'Fabricante'),
                ),
                validator: _required,
              ),
              PosFormField(
                controller: _model,
                decoration: PosFieldDecoration(labelText: t('Model', 'Modelo')),
                validator: _required,
              ),
              PosFormField(
                controller: _reference,
                decoration: PosFieldDecoration(
                  labelText: t('Public reference', 'Referencia pública'),
                ),
                validator: (value) =>
                    RegExp(r'^[A-Za-z0-9._:-]{1,160}$').hasMatch(value ?? '')
                    ? null
                    : t(
                        'Use letters, numbers, dots, colons, or dashes.',
                        'Usa letras, números, puntos, dos puntos o guiones.',
                      ),
              ),
              if (needsNetwork) ...[
                PosFormField(
                  controller: _host,
                  decoration: PosFieldDecoration(
                    labelText: t('Network host', 'Host de red'),
                  ),
                  validator: (value) =>
                      RegExp(r'^[A-Za-z0-9.-]{1,253}$').hasMatch(value ?? '')
                      ? null
                      : t('Enter a valid host.', 'Escribe un host válido.'),
                ),
                PosFormField(
                  controller: _port,
                  keyboardType: TextInputType.number,
                  decoration: PosFieldDecoration(
                    labelText: t('Network port', 'Puerto de red'),
                  ),
                  validator: (value) {
                    final port = int.tryParse(value ?? '');
                    return port != null && port >= 1 && port <= 65535
                        ? null
                        : t('Enter a valid port.', 'Escribe un puerto válido.');
                  },
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        PosTextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(t('Cancel', 'Cancelar')),
        ),
        PosButton(onPressed: _submit, child: Text(t('Register', 'Registrar'))),
      ],
    );
  }

  String? _required(String? value) => (value?.trim().isEmpty ?? true)
      ? t('This value is required.', 'Este valor es obligatorio.')
      : null;

  void _submit() {
    if (!(_form.currentState?.validate() ?? false)) return;
    final transport = simulator
        ? 'simulator'
        : switch (type) {
            'printer' => link == 'usb' ? 'usb_foundation' : 'network_tcp',
            'cash_drawer' => switch (link) {
              'usb' => 'usb_foundation',
              'terminal' => 'platform_channel_foundation',
              _ => 'printer_attached',
            },
            'barcode_scanner' => 'keyboard_wedge',
            _ => 'simulator',
          };
    final capabilities = switch (type) {
      'printer' => [
        'printer.receipt',
        // See the note on the USB quick-register list above: `printer.image` is
        // what lets the receipt draw the café's mark at all, and a receipt printer
        // registered without it prints the name and nothing above it.
        'printer.image',
        'printer.qr',
        'printer.cut',
        'printer.test_page',
      ],
      'cash_drawer' => ['drawer.open', 'drawer.status'],
      'barcode_scanner' => [
        'scanner.barcode',
        'scanner.qr',
        'scanner.continuous',
      ],
      _ => [
        'customer_display.text',
        'customer_display.totals',
        'customer_display.qr',
      ],
    };
    Navigator.pop(
      context,
      _HardwareDraft(
        type: type,
        manufacturer: _manufacturer.text.trim(),
        model: _model.text.trim(),
        publicReference: _reference.text.trim(),
        transport: transport,
        capabilities: capabilities,
        configuration: {
          'networkHost':
              transport == 'network_tcp' || transport == 'printer_attached'
              ? _host.text.trim()
              : null,
          'networkPort':
              transport == 'network_tcp' || transport == 'printer_attached'
              ? int.parse(_port.text)
              : null,
          'connectTimeoutMs': 2000,
          'commandTimeoutMs': 5000,
          'characterEncoding': 'cp850',
          'receiptWidthColumns': 42,
          'drawerPulsePin': 0,
          'drawerPulseOnMs': 50,
          'scannerTerminator': 'enter',
          'scannerBurstWindowMs': 80,
        },
      ),
    );
  }
}

final class _NetworkDraft {
  const _NetworkDraft(this.host, this.port);
  final String host;
  final int port;
}

final class _NetworkConfigurationDialog extends StatefulWidget {
  const _NetworkConfigurationDialog({
    required this.spanish,
    required this.host,
    required this.port,
  });
  final bool spanish;
  final String host;
  final int port;

  @override
  State<_NetworkConfigurationDialog> createState() =>
      _NetworkConfigurationDialogState();
}

final class _NetworkConfigurationDialogState
    extends State<_NetworkConfigurationDialog> {
  late final TextEditingController host = TextEditingController(
    text: widget.host,
  );
  late final TextEditingController port = TextEditingController(
    text: '${widget.port}',
  );

  @override
  void dispose() {
    host.dispose();
    port.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PosAlertDialog(
    title: Text(
      widget.spanish ? 'Configurar conexión' : 'Configure connection',
    ),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        PosField(
          controller: host,
          decoration: const PosFieldDecoration(labelText: 'Host'),
        ),
        PosField(
          controller: port,
          keyboardType: TextInputType.number,
          decoration: PosFieldDecoration(
            labelText: widget.spanish ? 'Puerto' : 'Port',
          ),
        ),
      ],
    ),
    actions: [
      PosTextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(widget.spanish ? 'Cancelar' : 'Cancel'),
      ),
      PosButton(
        onPressed: () {
          final parsed = int.tryParse(port.text);
          if (host.text.trim().isEmpty ||
              parsed == null ||
              parsed < 1 ||
              parsed > 65535) {
            return;
          }
          Navigator.pop(context, _NetworkDraft(host.text.trim(), parsed));
        },
        child: Text(widget.spanish ? 'Guardar' : 'Save'),
      ),
    ],
  );
}

final class PrinterSettingsDialog extends StatefulWidget {
  const PrinterSettingsDialog({
    required this.spanish,
    required this.initial,
    super.key,
  });
  final bool spanish;
  final Map<String, Object?> initial;

  @override
  State<PrinterSettingsDialog> createState() => _PrinterSettingsDialogState();
}

final class _PrinterSettingsDialogState extends State<PrinterSettingsDialog> {
  late bool autoPrint = widget.initial['autoPrintReceipt'] as bool? ?? true;
  // Drawer, no-sale, scanner and customer-display settings are read here only
  // so that saving keeps them as they were. None of them changes what this
  // till does today — the drawer and the scanner have no registered device,
  // the site has no customer display, and nothing reads allowNoSale — so they
  // are not shown. Bring the switch back when its device is registered.
  late bool cashSale = widget.initial['openDrawerOnCashSale'] as bool? ?? true;
  late bool cashRefund =
      widget.initial['openDrawerOnCashRefund'] as bool? ?? true;
  late bool allowNoSale = widget.initial['allowNoSale'] as bool? ?? false;
  late bool scanner = widget.initial['scannerEnabled'] as bool? ?? true;
  late bool display =
      widget.initial['customerDisplayEnabled'] as bool? ?? false;
  late int copies = widget.initial['receiptCopiesDefault'] as int? ?? 1;

  // Keep hidden policy fields intact when changing only receipt preferences.
  late int retryLimit = widget.initial['hardwareRetryLimit'] as int? ?? 2;
  late int healthIntervalSeconds =
      widget.initial['hardwareHealthIntervalSeconds'] as int? ?? 30;

  String t(String english, String spanish) =>
      widget.spanish ? spanish : english;

  @override
  Widget build(BuildContext context) => PosAlertDialog(
    title: Text(t('Printer settings', 'Ajustes de impresora')),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 72,
            child: PosSwitchRow(
              title: Text(
                t('Print receipt on checkout', 'Imprimir el recibo al cobrar'),
              ),
              value: autoPrint,
              trailingWidth: 96,
              contentPadding: const EdgeInsets.symmetric(horizontal: 16),
              onChanged: (next) => setState(() => autoPrint = next),
            ),
          ),
          SizedBox(
            height: 72,
            child: PosListRow(
              title: Text(t('Copies per receipt', 'Copias por recibo')),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16),
              trailing: SizedBox(
                width: 96,
                child: PosSelect<int>(
                  value: copies,
                  items: const [
                    PosSelectItem(value: 1, child: Text('1')),
                    PosSelectItem(value: 2, child: Text('2')),
                    PosSelectItem(value: 3, child: Text('3')),
                  ],
                  onChanged: (next) {
                    if (next != null) setState(() => copies = next);
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    ),
    actions: [
      PosTextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(t('Cancel', 'Cancelar')),
      ),
      PosButton(
        onPressed: () => Navigator.pop(context, {
          'autoPrintReceipt': autoPrint,
          'openDrawerOnCashSale': cashSale,
          'openDrawerOnCashRefund': cashRefund,
          'allowNoSale': allowNoSale,
          'receiptCopiesDefault': copies,
          'hardwareRetryLimit': retryLimit,
          'hardwareHealthIntervalSeconds': healthIntervalSeconds,
          'scannerEnabled': scanner,
          'customerDisplayEnabled': display,
        }),
        child: Text(t('Save', 'Guardar')),
      ),
    ],
  );
}
