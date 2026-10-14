import 'dart:convert';
import 'dart:io';

import 'tpm_sealed_storage.dart';

/// The native sealing backend. Selected by `sealing_backend.dart` on `dart:io`.
SealingBackend createSealingBackend() => SystemdCredsSealingBackend();

/// The outcome of one `systemd-creds` run.
final class CredentialResult {
  const CredentialResult(this.exitCode, this.stdout, this.stderr);
  final int exitCode;
  final List<int> stdout;
  final String stderr;
}

/// Runs `systemd-creds` and passes the input on stdin. Inject the runner in a
/// test so no test spawns a real process.
typedef CredentialRunner =
    Future<CredentialResult> Function(
      List<String> arguments, {
      List<int>? stdin,
    });

/// A [SealingBackend] backed by `systemd-creds`.
///
/// The key policy `host+tpm2` binds the blob to the host key and to the TPM 2.0.
/// The plaintext travels on stdin and stdout, so it never touches the disk.
///
/// The process needs access to `/dev/tpmrm0`. Run the till as a user in the
/// `tss` group, or let a systemd unit decrypt the blob with
/// `LoadCredentialEncrypted=` and hand the result to the app.
final class SystemdCredsSealingBackend implements SealingBackend {
  SystemdCredsSealingBackend({Directory? directory, CredentialRunner? run})
    : _directory = directory,
      _run = run ?? _runSystemdCreds;

  /// Binds the sealed blob to the host key and to the TPM 2.0.
  static const keyPolicy = 'host+tpm2';

  /// The executable to drive. `systemd-creds` ships with systemd 250 and later.
  static const executable = 'systemd-creds';

  final Directory? _directory;
  final CredentialRunner _run;

  Future<File> _sealedFile(String name) async {
    final base = _directory ?? _defaultDirectory();
    await base.create(recursive: true);
    return File('${base.path}/$name.cred');
  }

  Directory _defaultDirectory() {
    final environment = Platform.environment;
    final base =
        environment['XDG_DATA_HOME'] ??
        '${environment['HOME'] ?? '/var/lib'}/.local/share';
    return Directory('$base/umi-pos');
  }

  @override
  Future<void> store(String name, List<int> plaintext) async {
    final sealed = await _run(
      ['encrypt', '--with-key=$keyPolicy', '--name=$name', '-', '-'],
      stdin: plaintext,
    );
    if (sealed.exitCode != 0) {
      throw SealingException(
        '$executable encrypt failed: ${sealed.stderr.trim()}',
      );
    }
    final file = await _sealedFile(name);
    await file.writeAsBytes(sealed.stdout, flush: true);
  }

  @override
  Future<List<int>?> load(String name) async {
    final file = await _sealedFile(name);
    if (!await file.exists()) return null;
    final plain = await _run(
      ['decrypt', '--name=$name', '-', '-'],
      stdin: await file.readAsBytes(),
    );
    if (plain.exitCode != 0) {
      throw SealingException(
        '$executable decrypt failed: ${plain.stderr.trim()}',
      );
    }
    return plain.stdout;
  }

  @override
  Future<void> remove(String name) async {
    final file = await _sealedFile(name);
    if (await file.exists()) await file.delete();
  }
}

/// The default runner. It streams the input on stdin and collects the output.
Future<CredentialResult> _runSystemdCreds(
  List<String> arguments, {
  List<int>? stdin,
}) async {
  final process = await Process.start(
    SystemdCredsSealingBackend.executable,
    arguments,
  );
  if (stdin != null) process.stdin.add(stdin);
  await process.stdin.close();
  final output = <int>[];
  final errors = StringBuffer();
  await Future.wait([
    process.stdout.forEach(output.addAll),
    process.stderr.transform(utf8.decoder).forEach(errors.write),
  ]);
  return CredentialResult(await process.exitCode, output, errors.toString());
}
