import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/security/operator_permissions.dart';
import '../entry/entry_controller.dart';
import 'hardware_service.dart';

Future<void> showHardwareCenter(
  BuildContext context, {
  required EntryController entry,
  required HardwareService service,
  required OperatorPermissions permissions,
  required String? registerId,
}) => showModalBottomSheet<void>(
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
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
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
    return Scaffold(
      appBar: AppBar(
        title: Text(text('Hardware center', 'Centro de hardware')),
        actions: [
          IconButton(
            tooltip: text('Refresh hardware', 'Actualizar hardware'),
            onPressed: _busy ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: text('Close', 'Cerrar'),
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.close),
          ),
        ],
      ),
      body: SafeArea(
        child: _busy && snapshot == null
            ? const Center(child: CircularProgressIndicator())
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
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        if (widget.permissions.allows('hardware.manage'))
          Wrap(
            spacing: 8,
            children: [
              FilledButton.icon(
                onPressed: _busy ? null : _register,
                icon: const Icon(Icons.add),
                label: Text(text('Register device', 'Registrar dispositivo')),
              ),
              OutlinedButton.icon(
                onPressed: _busy || snapshot == null
                    ? null
                    : () => _configurePolicy(snapshot),
                icon: const Icon(Icons.policy_outlined),
                label: Text(text('Pilot policy', 'Política piloto')),
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
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        if (jobs.isEmpty)
          Text(text('The queue is empty.', 'La cola está vacía.')),
        ...jobs.map(_jobTile),
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
          FilledButton.tonalIcon(
            onPressed: _busy
                ? null
                : () => _diagnostic(
                    devices.firstWhere(
                      (device) => device.type == 'cash_drawer',
                    ),
                  ),
            icon: const Icon(Icons.point_of_sale_outlined),
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

  Widget _deviceCard(HardwareDevice device) => Card(
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
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Semantics(
                label: device.enabled
                    ? text('Device enabled', 'Dispositivo activo')
                    : text('Device disabled', 'Dispositivo inactivo'),
                child: Icon(
                  device.enabled ? Icons.check_circle : Icons.block,
                  color: device.enabled ? Colors.green : Colors.grey,
                ),
              ),
            ],
          ),
          Text('${device.manufacturer} ${device.model}'),
          Text(
            '${text('Connection', 'Conexión')}: ${_connection(device.connectionState)}',
          ),
          Text(
            '${text('Capabilities', 'Capacidades')}: '
            '${device.capabilities.map(_capability).join(', ')}',
          ),
          Text(
            '${text('Register', 'Caja')}: '
            '${device.registerId == null ? text('Not assigned', 'Sin asignar') : text('Assigned', 'Asignada')}',
          ),
          Wrap(
            spacing: 8,
            children: [
              if (_canTest(device))
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _diagnostic(device),
                  icon: const Icon(Icons.health_and_safety_outlined),
                  label: Text(text('Run test', 'Ejecutar prueba')),
                ),
              if (widget.permissions.allows('hardware.manage'))
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _configure(device),
                  icon: const Icon(Icons.settings_outlined),
                  label: Text(text('Configure', 'Configurar')),
                ),
              if (widget.permissions.allows('hardware.assign') &&
                  (device.registerId != widget.registerId ||
                      device.assignedPosDeviceId !=
                          widget.entry.state.device?.id ||
                      (device.type == 'printer' && device.primary != true)))
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _assignHere(device),
                  icon: const Icon(Icons.assignment_turned_in_outlined),
                  label: Text(
                    device.type == 'printer'
                        ? text('Use as primary', 'Usar como principal')
                        : text('Assign here', 'Asignar aquí'),
                  ),
                ),
              if (widget.permissions.allows('hardware.manage'))
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _toggle(device),
                  icon: Icon(device.enabled ? Icons.pause : Icons.play_arrow),
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

  Widget _jobTile(PrintJob job) => ListTile(
    leading: const Icon(Icons.print_outlined),
    title: Text('${_jobType(job.type)} · ${job.sourceAggregateId}'),
    subtitle: Text(_jobStatus(job.status)),
    trailing:
        job.status == 'retryable_failure' &&
            widget.permissions.allows('hardware.printer.print')
        ? TextButton(
            onPressed: _busy ? null : () => _retry(job),
            child: Text(text('Retry', 'Reintentar')),
          )
        : widget.permissions.allows('hardware.printer.reprint') &&
              {
                'printed',
                'terminal_failure',
                'unknown_outcome',
              }.contains(job.status)
        ? TextButton(
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
      await widget.service.runDiagnostic(
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
    } catch (_) {
      if (mounted) setState(() => _error = 'hardware_diagnostic_failed');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _register() async {
    final scope = _scope;
    if (scope == null) return;
    final result = await showDialog<_HardwareDraft>(
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
      if (mounted) setState(() => _error = 'hardware_register_failed');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _configure(HardwareDevice device) async {
    if (!{'network_tcp', 'printer_attached'}.contains(device.transport)) return;
    final scope = _scope;
    if (scope == null) return;
    final current = device.connectionConfiguration ?? const {};
    final result = await showDialog<_NetworkDraft>(
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
      if (mounted) setState(() => _error = 'hardware_configuration_failed');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _configurePolicy(HardwareRuntimeSnapshot snapshot) async {
    final scope = _scope;
    if (scope == null) return;
    final result = await showDialog<Map<String, Object?>>(
      context: context,
      builder: (_) => _HardwarePolicyDialog(
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
      if (mounted) setState(() => _error = 'hardware_policy_failed');
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
      if (mounted) setState(() => _error = 'hardware_update_failed');
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
      if (mounted) setState(() => _error = 'hardware_assignment_failed');
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
      if (mounted) setState(() => _error = 'hardware_reprint_failed');
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
      if (mounted) setState(() => _error = 'hardware_print_retry_failed');
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

  String _connection(String value) => switch (value) {
    'connected' => text('Connected', 'Conectado'),
    'disconnected' => text('Disconnected', 'Desconectado'),
    'connecting' => text('Connecting', 'Conectando'),
    'busy' => text('Busy', 'Ocupado'),
    'error' => text('Error', 'Error'),
    _ => text('Unknown', 'Desconocido'),
  };

  String _capability(String value) => switch (value) {
    'printer.receipt' => text('Receipt print', 'Impresión de recibo'),
    'printer.image' => text('Image print', 'Impresión de imagen'),
    'printer.qr' => text('QR print', 'Impresión de QR'),
    'printer.cut' => text('Paper cut', 'Corte de papel'),
    'printer.test_page' => text('Test page', 'Página de prueba'),
    'drawer.open' => text('Drawer open', 'Apertura del cajón'),
    'drawer.status' => text('Drawer status', 'Estado del cajón'),
    'scanner.barcode' => text('Barcode scan', 'Lectura de código'),
    'scanner.qr' => text('QR scan', 'Lectura de QR'),
    'scanner.continuous' => text('Continuous scan', 'Lectura continua'),
    'scanner.single' => text('Single scan', 'Lectura única'),
    'customer_display.text' => text('Display text', 'Texto en pantalla'),
    'customer_display.totals' => text('Display totals', 'Totales en pantalla'),
    'customer_display.qr' => text('Display QR', 'QR en pantalla'),
    _ => text('Foundation capability', 'Capacidad base'),
  };
  String _jobType(String value) => value == 'receipt_copy'
      ? text('Receipt copy', 'Copia de recibo')
      : text('Receipt', 'Recibo');
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
        !simulator && {'printer', 'cash_drawer'}.contains(type);
    return AlertDialog(
      title: Text(t('Register pilot hardware', 'Registrar hardware piloto')),
      content: Form(
        key: _form,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: type,
                decoration: InputDecoration(
                  labelText: t('Device type', 'Tipo de dispositivo'),
                ),
                items: [
                  DropdownMenuItem(
                    value: 'printer',
                    child: Text(t('Printer', 'Impresora')),
                  ),
                  DropdownMenuItem(
                    value: 'cash_drawer',
                    child: Text(t('Cash drawer', 'Cajón de efectivo')),
                  ),
                  DropdownMenuItem(
                    value: 'barcode_scanner',
                    child: Text(t('Barcode scanner', 'Escáner de códigos')),
                  ),
                  DropdownMenuItem(
                    value: 'customer_display',
                    child: Text(t('Customer display', 'Pantalla del cliente')),
                  ),
                ],
                onChanged: (value) => setState(() => type = value ?? type),
              ),
              SwitchListTile(
                value: simulator,
                onChanged: (value) => setState(() => simulator = value),
                title: Text(t('Use simulator', 'Usar simulador')),
              ),
              TextFormField(
                controller: _manufacturer,
                decoration: InputDecoration(
                  labelText: t('Manufacturer', 'Fabricante'),
                ),
                validator: _required,
              ),
              TextFormField(
                controller: _model,
                decoration: InputDecoration(labelText: t('Model', 'Modelo')),
                validator: _required,
              ),
              TextFormField(
                controller: _reference,
                decoration: InputDecoration(
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
                TextFormField(
                  controller: _host,
                  decoration: InputDecoration(
                    labelText: t('Network host', 'Host de red'),
                  ),
                  validator: (value) =>
                      RegExp(r'^[A-Za-z0-9.-]{1,253}$').hasMatch(value ?? '')
                      ? null
                      : t('Enter a valid host.', 'Escribe un host válido.'),
                ),
                TextFormField(
                  controller: _port,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
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
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(t('Cancel', 'Cancelar')),
        ),
        FilledButton(
          onPressed: _submit,
          child: Text(t('Register', 'Registrar')),
        ),
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
            'printer' => 'network_tcp',
            'cash_drawer' => 'printer_attached',
            'barcode_scanner' => 'keyboard_wedge',
            _ => 'simulator',
          };
    final capabilities = switch (type) {
      'printer' => [
        'printer.receipt',
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
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      widget.spanish ? 'Configurar conexión' : 'Configure connection',
    ),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          controller: host,
          decoration: const InputDecoration(labelText: 'Host'),
        ),
        TextField(
          controller: port,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: widget.spanish ? 'Puerto' : 'Port',
          ),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(widget.spanish ? 'Cancelar' : 'Cancel'),
      ),
      FilledButton(
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

final class _HardwarePolicyDialog extends StatefulWidget {
  const _HardwarePolicyDialog({required this.spanish, required this.initial});
  final bool spanish;
  final Map<String, Object?> initial;

  @override
  State<_HardwarePolicyDialog> createState() => _HardwarePolicyDialogState();
}

final class _HardwarePolicyDialogState extends State<_HardwarePolicyDialog> {
  late bool autoPrint = widget.initial['autoPrintReceipt'] as bool? ?? true;
  late bool cashSale = widget.initial['openDrawerOnCashSale'] as bool? ?? true;
  late bool cashRefund =
      widget.initial['openDrawerOnCashRefund'] as bool? ?? true;
  late bool allowNoSale = widget.initial['allowNoSale'] as bool? ?? false;
  late bool scanner = widget.initial['scannerEnabled'] as bool? ?? true;
  late bool display =
      widget.initial['customerDisplayEnabled'] as bool? ?? false;
  late int copies = widget.initial['receiptCopiesDefault'] as int? ?? 1;
  late int retries = widget.initial['hardwareRetryLimit'] as int? ?? 2;
  late int health =
      widget.initial['hardwareHealthIntervalSeconds'] as int? ?? 30;

  String t(String english, String spanish) =>
      widget.spanish ? spanish : english;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(t('Pilot hardware policy', 'Política de hardware piloto')),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _toggle(
            t('Auto-print receipts', 'Imprimir recibos automáticamente'),
            autoPrint,
            (value) => autoPrint = value,
          ),
          _toggle(
            t(
              'Open drawer for cash sales',
              'Abrir el cajón en ventas en efectivo',
            ),
            cashSale,
            (value) => cashSale = value,
          ),
          _toggle(
            t(
              'Open drawer for cash refunds',
              'Abrir el cajón en reembolsos en efectivo',
            ),
            cashRefund,
            (value) => cashRefund = value,
          ),
          _toggle(
            t('Allow approved No Sale', 'Permitir Sin venta aprobado'),
            allowNoSale,
            (value) => allowNoSale = value,
          ),
          _toggle(
            t('Enable scanner', 'Activar el escáner'),
            scanner,
            (value) => scanner = value,
          ),
          _toggle(
            t('Enable customer display', 'Activar la pantalla del cliente'),
            display,
            (value) => display = value,
          ),
          _choice(t('Receipt copies', 'Copias del recibo'), copies, const [
            1,
            2,
            3,
          ], (value) => copies = value),
          _choice(
            t('Retry limit', 'Límite de reintentos'),
            retries,
            const [1, 2, 3],
            (value) => retries = value,
          ),
          _choice(
            t('Health interval in seconds', 'Intervalo de estado en segundos'),
            health,
            const [15, 30, 60, 120, 300],
            (value) => health = value,
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(t('Cancel', 'Cancelar')),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, {
          'autoPrintReceipt': autoPrint,
          'openDrawerOnCashSale': cashSale,
          'openDrawerOnCashRefund': cashRefund,
          'allowNoSale': allowNoSale,
          'receiptCopiesDefault': copies,
          'hardwareRetryLimit': retries,
          'hardwareHealthIntervalSeconds': health,
          'scannerEnabled': scanner,
          'customerDisplayEnabled': display,
        }),
        child: Text(t('Save', 'Guardar')),
      ),
    ],
  );

  Widget _toggle(String label, bool value, ValueChanged<bool> update) =>
      SwitchListTile(
        title: Text(label),
        value: value,
        onChanged: (next) => setState(() => update(next)),
      );

  Widget _choice(
    String label,
    int value,
    List<int> values,
    ValueChanged<int> update,
  ) => DropdownButtonFormField<int>(
    initialValue: value,
    decoration: InputDecoration(labelText: label),
    items: values
        .map((item) => DropdownMenuItem(value: item, child: Text('$item')))
        .toList(),
    onChanged: (next) {
      if (next != null) setState(() => update(next));
    },
  );
}
