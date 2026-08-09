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
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (_) => FractionallySizedBox(
    heightFactor: .9,
    child: HardwareSurface(
      entry: entry,
      service: service,
      permissions: permissions,
    ),
  ),
);

final class HardwareSurface extends StatefulWidget {
  const HardwareSurface({
    required this.entry,
    required this.service,
    required this.permissions,
    super.key,
  });

  final EntryController entry;
  final HardwareService service;
  final OperatorPermissions permissions;

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
    if (merchant == null || location == null || operator == null) return null;
    return HardwareScope(
      merchantId: merchant.id,
      locationId: location.id,
      operatorSessionId: operator.id,
      registerId: null,
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
    if (snapshot == null || snapshot.devices.isEmpty) {
      return Center(
        child: Text(text('No assigned hardware.', 'No hay hardware asignado.')),
      );
    }
    final devices = snapshot.devices.map(HardwareDevice.fromJson).toList();
    final jobs = (snapshot.printJobs ?? const [])
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
        const SizedBox(height: 8),
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
        if (snapshot.unknownCommands > 0)
          Semantics(
            liveRegion: true,
            child: Text(
              text(
                'A hardware result requires physical verification.',
                'Un resultado de hardware requiere verificación física.',
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
              if (widget.permissions.allows('hardware.diagnostics'))
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _diagnostic(device),
                  icon: const Icon(Icons.health_and_safety_outlined),
                  label: Text(text('Run test', 'Ejecutar prueba')),
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
        widget.permissions.allows('hardware.printer.reprint') &&
            {'terminal_failure', 'unknown_outcome'}.contains(job.status)
        ? TextButton(
            onPressed: _busy ? null : () => _reprint(job),
            child: Text(text('Controlled reprint', 'Reimpresión controlada')),
          )
        : null,
  );

  Future<void> _diagnostic(HardwareDevice device) async {
    final scope = _scope;
    if (scope == null) return;
    setState(() => _busy = true);
    try {
      await widget.service.runDiagnostic(
        scope: scope,
        hardwareId: device.id,
        diagnostic: 'connection_test',
      );
      await _load();
    } catch (_) {
      if (mounted) setState(() => _error = 'hardware_diagnostic_failed');
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
