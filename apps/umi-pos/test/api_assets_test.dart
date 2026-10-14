import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/config/api_assets.dart';

/// A receipt freezes its mark's URL when the sale commits, and those URLs were
/// written for the development setup. These are the rules that keep the mark
/// reachable after the setup moves.
void main() {
  test('repairs a frozen loopback address onto the configured API', () {
    expect(
      resolveApiAssetUri(
        'http://127.0.0.1:4001/logos/onca-8897324fdb0ca066.png',
        Uri.parse('http://192.168.1.9:4001'),
      ).toString(),
      'http://192.168.1.9:4001/logos/onca-8897324fdb0ca066.png',
    );
    expect(
      resolveApiAssetUri(
        'http://localhost:4001/logos/onca.png',
        Uri.parse('https://api.umi.example'),
      ).toString(),
      'https://api.umi.example/logos/onca.png',
    );
  });

  test('leaves any other host exactly as it was written', () {
    const url = 'https://cdn.example.com/logos/onca.png';
    expect(
      resolveApiAssetUri(url, Uri.parse('http://192.168.1.9:4001')).toString(),
      url,
    );
  });

  test('uses the URL as written when the build carries no API base', () {
    const url = 'http://127.0.0.1:4001/logos/onca.png';
    expect(resolveApiAssetUri(url, null).toString(), url);
  });
}
