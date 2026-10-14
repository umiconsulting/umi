/// Where a receipt's assets actually live.
///
/// A receipt freezes the café's mark as a URL when the sale commits, and every one
/// of those URLs was written for the developer setup: `http://127.0.0.1:4001/logos/…`,
/// which is the workstation only while an `adb reverse` tunnel exists. The day the
/// till was pointed straight at the LAN address the tunnel went away, and the mark
/// disappeared from the paper AND from the receipt on screen — the frozen URL said
/// 127.0.0.1 and the till, quite literally, asked itself.
///
/// Nothing is re-frozen and no snapshot is rewritten: a loopback host is the till's
/// own machine and never the API, so it is swapped for the host this build is
/// configured with. Every other URL is left exactly as it was written.
library;

/// The API this build points at, straight from the compiler.
Uri? configuredApiBaseUri() {
  const raw = String.fromEnvironment('UMIPOS_API_BASE_URL');
  if (raw.trim().isEmpty) return null;
  final uri = Uri.tryParse(raw.trim());
  if (uri == null || uri.host.isEmpty) return null;
  return uri;
}

/// [url] with a loopback host repaired onto [base], or the URL untouched.
Uri resolveApiAssetUri(String url, Uri? base) {
  final parsed = Uri.tryParse(url);
  if (parsed == null || parsed.host.isEmpty) return Uri.parse(url);
  if (base == null || base.host.isEmpty) return parsed;
  final loopback =
      parsed.host == '127.0.0.1' ||
      parsed.host == 'localhost' ||
      parsed.host == '::1' ||
      parsed.host == '[::1]';
  if (!loopback) return parsed;
  return Uri(
    scheme: base.scheme.isEmpty ? parsed.scheme : base.scheme,
    host: base.host,
    port: base.hasPort ? base.port : null,
    path: parsed.path,
    query: parsed.hasQuery ? parsed.query : null,
  );
}

/// The same repair, reading the base this build was compiled with.
String resolveApiAssetUrl(String url) =>
    resolveApiAssetUri(url, configuredApiBaseUri()).toString();
