import 'dart:io';

import 'tpm_device_key.dart';

/// The native TPM backend. Selected by `tpm_backend.dart` on `dart:io` targets.
TpmBackend createTpmBackend() => Tpm2ToolsBackend();

/// Runs a command and returns its result. Injected so tests never spawn a real
/// process; the default is [Process.run], which inherits the parent
/// environment (so `TPM2TOOLS_TCTI` selects the TPM: a real `/dev/tpmrm0`, or a
/// simulator via `mssim:host=...`).
typedef TpmCommandRunner =
    Future<ProcessResult> Function(String executable, List<String> arguments);

/// A [TpmBackend] backed by `tpm2-tools`. It keeps one ECDSA P-256 signing key
/// persisted at [persistentHandle] inside the TPM, so the device key survives
/// app restarts and is addressed by handle rather than re-created.
///
/// Desktop only (Linux, or Windows with a TPM). It lives in its own `dart:io`
/// file so the web build never imports it; the composition root selects it
/// behind a conditional import.
final class Tpm2ToolsBackend implements TpmBackend {
  Tpm2ToolsBackend({
    this.persistentHandle = '0x81018801',
    Directory? workDir,
    TpmCommandRunner? run,
  }) : _run = run ?? Process.run,
       _workDir = workDir;

  /// A persistent handle in the owner range that holds the device signing key.
  final String persistentHandle;
  final Directory? _workDir;
  final TpmCommandRunner _run;

  Future<Directory> _dir() async =>
      _workDir ?? await Directory.systemTemp.createTemp('umi_tpm_');

  @override
  Future<String> ensureKeyPublicKeyPem() async {
    final dir = await _dir();
    final pemPath = '${dir.path}/device_pub.pem';

    // Already persisted from a previous run? Read its public key and stop.
    final existing = await _run('tpm2_readpublic', [
      '-c', persistentHandle, '-f', 'pem', '-o', pemPath, //
    ]);
    if (existing.exitCode == 0) return File(pemPath).readAsString();

    // Create an unrestricted P-256 signing key as the primary (a single
    // transient object — a primary+child pair exhausts a small TPM's object
    // memory), then evict it to the persistent handle.
    final ctxPath = '${dir.path}/primary.ctx';
    final created = await _run('tpm2_createprimary', [
      '-C', 'o', '-g', 'sha256', '-G', 'ecc256', '-c', ctxPath, //
      '-a', 'fixedtpm|fixedparent|sensitivedataorigin|userwithauth|sign',
    ]);
    if (created.exitCode != 0) {
      throw TpmException('tpm2_createprimary failed: ${created.stderr}');
    }
    final evicted = await _run('tpm2_evictcontrol', [
      '-C', 'o', '-c', ctxPath, persistentHandle, //
    ]);
    if (evicted.exitCode != 0) {
      throw TpmException('tpm2_evictcontrol failed: ${evicted.stderr}');
    }
    final read = await _run('tpm2_readpublic', [
      '-c', persistentHandle, '-f', 'pem', '-o', pemPath, //
    ]);
    if (read.exitCode != 0) {
      throw TpmException('tpm2_readpublic failed: ${read.stderr}');
    }
    return File(pemPath).readAsString();
  }

  @override
  Future<List<int>> signToDer(List<int> message) async {
    final dir = await _dir();
    final messagePath = '${dir.path}/message.bin';
    final signaturePath = '${dir.path}/signature.sig';
    await File(messagePath).writeAsBytes(message, flush: true);

    final signed = await _run('tpm2_sign', [
      '-c', persistentHandle, '-g', 'sha256', '-s', 'ecdsa', //
      '-f', 'plain', '-o', signaturePath, messagePath,
    ]);
    if (signed.exitCode != 0) {
      throw TpmException('tpm2_sign failed: ${signed.stderr}');
    }
    return File(signaturePath).readAsBytes();
  }
}
