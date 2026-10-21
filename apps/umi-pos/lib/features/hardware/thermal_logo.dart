import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:umi_pos/core/config/api_assets.dart';

import '../../core/storage/local_working_copy.dart';
import 'print_trace.dart';

/// One picture the head can draw: 1 bit per dot, each row padded to whole bytes,
/// most significant bit leftmost. That is the layout `GS v 0` wants, so the
/// encoder writes it out with no translation and nothing to disagree about.
final class ThermalRaster {
  const ThermalRaster({
    required this.widthDots,
    required this.heightDots,
    required this.rows,
  });

  final int widthDots;
  final int heightDots;
  final List<int> rows;

  int get bytesPerRow => (widthDots + 7) ~/ 8;
  bool get isEmpty => heightDots <= 0 || rows.isEmpty || widthDots <= 0;

  /// The same mark, CENTRED on a head this wide.
  ///
  /// `GS v 0` draws from the left margin and this printer family ignores the
  /// justification setting for a raster, so a 384-dot mark on an 80 mm head came
  /// out jammed against the paper's left edge while every line under it was
  /// centred — measured on the Epson TM-T20IIIL at the ONCA till, 2026-10-11.
  /// The padding is white dots in the same 1-bit layout, so the head draws exactly
  /// what it is handed and the picture lands in the middle whatever the paper is.
  ///
  /// Byte granularity, which is as fine as the layout allows: the offset moves in
  /// steps of eight dots (1 mm at 203 dpi), so a mark whose width is not a multiple
  /// of eight can sit up to four dots — half a millimetre — off true centre.
  ThermalRaster centredOn(int paperWidthDots) {
    if (isEmpty || paperWidthDots <= widthDots) return this;
    final targetBytesPerRow = (paperWidthDots + 7) ~/ 8;
    if (targetBytesPerRow <= bytesPerRow) return this;
    final lead = (targetBytesPerRow - bytesPerRow) ~/ 2;
    final padded = List<int>.filled(targetBytesPerRow * heightDots, 0);
    for (var y = 0; y < heightDots; y += 1) {
      final target = y * targetBytesPerRow + lead;
      final source = y * bytesPerRow;
      padded.setRange(target, target + bytesPerRow, rows, source);
    }
    return ThermalRaster(
      widthDots: targetBytesPerRow * 8,
      heightDots: heightDots,
      rows: padded,
    );
  }
}

/// How wide a mark the head is asked for, and how tall it may be. A logo drawn on
/// a receipt is a header, not the receipt: 384 dots is the 58 mm head's full width
/// and barely half of the 80 mm one, which is where a receipt mark belongs. The
/// height cap keeps a square mark from eating the ticket.
const int kThermalLogoWidthDots = 384;
const int kThermalLogoMaxHeightDots = 192;

/// Turn a decoded RGBA bitmap into the head's raster.
///
/// Pure on purpose: no engine, no network, no clock. Alpha is flattened over WHITE
/// because the paper is white — a mark stored with a transparent ground must not
/// print as a black square. Each output dot then averages the source pixels under
/// it and compares that average with the threshold, which is what keeps a resized
/// line drawing from turning into a dotted line.
ThermalRaster rasteriseThermalLogo(
  Uint8List rgba, {
  required int width,
  required int height,
  int widthDots = kThermalLogoWidthDots,
  int maxHeightDots = kThermalLogoMaxHeightDots,
  int threshold = 128,
}) {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return const ThermalRaster(widthDots: 0, heightDots: 0, rows: []);
  }
  // One scale for both axes: the mark keeps its proportions whatever it is.
  // Never larger than the source: a mark drawn small prints small, and blowing one
  // up would spend paper on interpolation the head cannot draw.
  final scale = [
    widthDots / width,
    maxHeightDots / height,
    1.0,
  ].reduce((a, b) => a < b ? a : b);
  final targetWidth = (width * scale).round().clamp(1, widthDots);
  final targetHeight = (height * scale).round().clamp(1, maxHeightDots);
  final bytesPerRow = (targetWidth + 7) ~/ 8;
  final rows = List<int>.filled(bytesPerRow * targetHeight, 0);

  for (var y = 0; y < targetHeight; y += 1) {
    final y0 = y * height ~/ targetHeight;
    final y1 = ((y + 1) * height ~/ targetHeight).clamp(y0 + 1, height);
    for (var x = 0; x < targetWidth; x += 1) {
      final x0 = x * width ~/ targetWidth;
      final x1 = ((x + 1) * width ~/ targetWidth).clamp(x0 + 1, width);
      var total = 0.0;
      var samples = 0;
      for (var sy = y0; sy < y1; sy += 1) {
        for (var sx = x0; sx < x1; sx += 1) {
          final index = (sy * width + sx) * 4;
          final alpha = rgba[index + 3] / 255.0;
          final red = rgba[index] * alpha + 255 * (1 - alpha);
          final green = rgba[index + 1] * alpha + 255 * (1 - alpha);
          final blue = rgba[index + 2] * alpha + 255 * (1 - alpha);
          total += 0.299 * red + 0.587 * green + 0.114 * blue;
          samples += 1;
        }
      }
      if (samples == 0) continue;
      if (total / samples < threshold) {
        rows[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return ThermalRaster(
    widthDots: targetWidth,
    heightDots: targetHeight,
    rows: rows,
  );
}

/// Where a print job's picture comes from. An interface because the adapter is
/// unit-tested without a network, and because a till with no mark — or no network —
/// must still print its receipt.
abstract interface class ThermalLogoSource {
  Future<ThermalRaster?> raster(
    String url, {
    int widthDots = kThermalLogoWidthDots,
    int maxHeightDots = kThermalLogoMaxHeightDots,
  });
}

/// A mark that survives an app restart.
///
/// The URL is content-addressed, so the same URL is always the same picture. The
/// first print after a cold start used to fetch, decode and rasterize the 768 px
/// source again; measured on the iMin, that was 1.31 s against 388 ms for the next
/// copy in the same process. Persisting the one-bit raster moves that work off the
/// subsequent cold print path.
final class CachedThermalLogoSource implements ThermalLogoSource {
  CachedThermalLogoSource(
    this._source,
    this._local, {
    Duration negativeCacheDuration = const Duration(seconds: 30),
    DateTime Function()? now,
  }) : _negativeCacheDuration = negativeCacheDuration,
       _now = now ?? DateTime.now;

  static const namespace = 'thermal_logo';

  final ThermalLogoSource _source;
  final LocalWorkingCopy _local;
  final Duration _negativeCacheDuration;
  final DateTime Function() _now;
  final Map<String, ThermalRaster> _memory = {};
  final Map<String, Future<ThermalRaster?>> _loading = {};
  final Map<String, DateTime> _negativeUntil = {};

  String _scope(int widthDots, int maxHeightDots) =>
      '$widthDots:$maxHeightDots';

  String _id(String url) => sha256.convert(utf8.encode(url)).toString();

  @override
  Future<ThermalRaster?> raster(
    String url, {
    int widthDots = kThermalLogoWidthDots,
    int maxHeightDots = kThermalLogoMaxHeightDots,
  }) async {
    final key = '$url@$widthDots:$maxHeightDots';
    final remembered = _memory[key];
    if (remembered != null) {
      printTrace('logo.memory_hit', {'id': _id(url).substring(0, 8)});
      return remembered;
    }
    final loading = _loading[key];
    if (loading != null) {
      printTrace('logo.join_inflight', {'id': _id(url).substring(0, 8)});
      return loading;
    }
    final future = _load(key, url, widthDots, maxHeightDots);
    _loading[key] = future;
    try {
      return await future;
    } finally {
      if (identical(_loading[key], future)) _loading.remove(key)?.ignore();
    }
  }

  Future<ThermalRaster?> _load(
    String key,
    String url,
    int widthDots,
    int maxHeightDots,
  ) async {
    final scope = _scope(widthDots, maxHeightDots);
    final id = _id(url);
    try {
      final document = await _local.readDocument(namespace, scope, id);
      final raster = _fromDocument(document, url, widthDots, maxHeightDots);
      if (raster != null) {
        printTrace('logo.disk_hit', {'id': id.substring(0, 8)});
        _memory[key] = raster;
        return raster;
      }
    } catch (_) {
      // A damaged cache entry is a cache miss, never a failed receipt.
    }
    printTrace('logo.cache_miss', {'id': id.substring(0, 8)});
    final negativeUntil = _negativeUntil[key];
    final now = _now();
    if (negativeUntil != null && now.isBefore(negativeUntil)) {
      return null;
    }
    _negativeUntil.remove(key);
    final ThermalRaster? raster;
    try {
      final fetchedAt = Stopwatch()..start();
      raster = await _source.raster(
        url,
        widthDots: widthDots,
        maxHeightDots: maxHeightDots,
      );
      printTrace('logo.fetched', {
        'id': id.substring(0, 8),
        'ms': fetchedAt.elapsedMilliseconds,
      });
    } catch (_) {
      _negativeUntil[key] = now.add(_negativeCacheDuration);
      return null;
    }
    if (raster == null) {
      _negativeUntil[key] = now.add(_negativeCacheDuration);
      return null;
    }
    _memory[key] = raster;
    try {
      final persistedAt = Stopwatch()..start();
      await _local.writeDocument(
        namespace: namespace,
        scopeKey: scope,
        id: id,
        payload: {
          'url': url,
          'widthDots': raster.widthDots,
          'heightDots': raster.heightDots,
          'rows': base64Encode(raster.rows),
        },
      );
      printTrace('logo.persisted', {
        'id': id.substring(0, 8),
        'ms': persistedAt.elapsedMilliseconds,
      });
    } catch (_) {
      // The in-memory raster still makes this receipt fast; persistence is an
      // optimisation for the next process, not a condition of printing.
    }
    return raster;
  }

  ThermalRaster? _fromDocument(
    Map<String, Object?>? document,
    String url,
    int widthDots,
    int maxHeightDots,
  ) {
    if (document == null || document['url'] != url) return null;
    final savedWidth = (document['widthDots'] as num?)?.toInt();
    final height = (document['heightDots'] as num?)?.toInt();
    final encoded = document['rows'];
    if (savedWidth == null ||
        savedWidth < 1 ||
        savedWidth > widthDots ||
        height == null ||
        height < 1 ||
        height > maxHeightDots ||
        encoded is! String) {
      return null;
    }
    final rows = base64Decode(encoded);
    final expectedBytes = ((savedWidth + 7) ~/ 8) * height;
    if (rows.length != expectedBytes) return null;
    return ThermalRaster(widthDots: savedWidth, heightDots: height, rows: rows);
  }
}

/// The real one: fetch the café's mark and decode it.
///
/// The URL is content-addressed (`/logos/{merchant}-{sha}.png`), so the same URL
/// is always the same picture: a till that prints a hundred receipts fetches it
/// once, and an upload that changes the mark is a different URL, which is why this
/// cache never needs invalidating.
final class HttpThermalLogoSource implements ThermalLogoSource {
  HttpThermalLogoSource({
    http.Client? client,
    this.timeout = const Duration(seconds: 4),
    this.apiBaseUri,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final Duration timeout;

  /// The API this till talks to. See [_resolved].
  final Uri? apiBaseUri;
  final Map<String, ThermalRaster?> _cache = {};

  @override
  Future<ThermalRaster?> raster(
    String url, {
    int widthDots = kThermalLogoWidthDots,
    int maxHeightDots = kThermalLogoMaxHeightDots,
  }) async {
    final key = '$url@$widthDots';
    if (_cache.containsKey(key)) return _cache[key];
    ThermalRaster? raster;
    try {
      // The mark is fetched from the API this till is pointed at — see
      // `resolveApiAssetUri` for why a frozen loopback URL has to be repaired.
      final response = await _client
          .get(resolveApiAssetUri(url, apiBaseUri))
          .timeout(timeout);
      if (response.statusCode == 200 && response.bodyBytes.isNotEmpty) {
        final codec = await ui.instantiateImageCodec(response.bodyBytes);
        final frame = await codec.getNextFrame();
        final image = frame.image;
        final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
        if (data != null) {
          raster = rasteriseThermalLogo(
            data.buffer.asUint8List(),
            width: image.width,
            height: image.height,
            widthDots: widthDots,
            maxHeightDots: maxHeightDots,
          );
        }
        image.dispose();
      }
    } catch (_) {
      // A mark that cannot be fetched is a receipt without one. It is never a
      // reason to refuse the sale's paper.
      raster = null;
    }
    _cache[key] = raster;
    return raster;
  }
}
