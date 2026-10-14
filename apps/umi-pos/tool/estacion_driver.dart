import 'dart:convert';
import 'dart:io';
import 'package:flutter_driver/flutter_driver.dart';
import '../test_driver/pos_tooltip_finder.dart';

Future<void> main(List<String> args) async {
  final vm = args.first;
  final command = args.length > 1 ? args[1] : 'snapshot';
  final driver = await FlutterDriver.connect(
    dartVmServiceUrl: vm,
    printCommunication: false,
  );
  try {
    await driver.runUnsynchronized(() async {
      if (['enroll', 'enter', 'enter-label', 'enter-field'].contains(command)) {
        await driver.setTextEntryEmulation(enabled: true);
      }
      if (command == 'native-text-input') {
        await driver.setTextEntryEmulation(enabled: false);
        stdout.writeln('Native text input enabled.');
      } else if (command == 'navigation-text') {
        stdout.writeln(await driver.requestData('navigation-text'));
      } else if (command == 'receipt-probe') {
        stdout.writeln(await driver.requestData('receipt-probe:${args[2]}'));
      } else if (command == 'focus-label') {
        await driver.scrollIntoView(
          PosEditableFieldFinder(args[2]),
          alignment: .5,
          timeout: const Duration(seconds: 10),
        );
        await driver.requestData('frame');
        await tapReady(
          driver,
          PosEditableFieldFinder(args[2]),
          timeout: const Duration(seconds: 10),
        );
        await driver.requestData('frame');
      } else if (command == 'text-label') {
        stdout.writeln(
          await driver.getText(
            PosEditableFieldFinder(args[2]),
            timeout: const Duration(seconds: 10),
          ),
        );
      } else if (command == 'trace-catalog') {
        final timeline = await driver.traceAction(() async {
          for (var i = 0; i < 12; i++) {
            await tapReady(
              driver,
              find.descendant(
                of: find.byType('_Category'),
                matching: find.text(i.isEven ? 'Alimentos' : 'Todo'),
              ),
            );
            await driver.requestData('frame');
          }
        });
        final folder = Directory(args[2])..createSync(recursive: true);
        final summary = TimelineSummary.summarize(timeline).summaryJson;
        await File(
          '${folder.path}/catalog.timeline_summary.json',
        ).writeAsString(const JsonEncoder.withIndent('  ').convert(summary));
        final frames = (timeline.json['traceEvents'] as List<Object?>)
            .cast<Map<String, Object?>>()
            .where(
              (event) =>
                  ['Frame', 'GPURasterizer::Draw'].contains(event['name']),
            )
            .map(
              (event) => {
                for (final key in ['name', 'ph', 'ts', 'dur', 'pid', 'tid'])
                  if (event.containsKey(key)) key: event[key],
              },
            )
            .toList();
        await File('${folder.path}/catalog.frames.json').writeAsString(
          const JsonEncoder.withIndent('  ').convert({
            'traceEvents': frames,
            'scope': '12 category taps, profile, 1280 × 720',
            'filter': 'Frame and GPURasterizer::Draw; event arguments omitted',
          }),
        );
        stdout.writeln('Timeline saved: ${args[2]}');
      } else if (command == 'tap') {
        await tapReady(
          driver,
          find.text(args[2]),
          timeout: const Duration(seconds: 10),
        );
      } else if (command == 'tap-text-under') {
        final section = find.ancestor(
          of: find.text(args[3]),
          matching: find.byType(args[2]),
        );
        final target = find.descendant(
          of: section,
          matching: find.text(args[4]),
        );
        await driver.scrollIntoView(
          target,
          alignment: .5,
          timeout: const Duration(seconds: 10),
        );
        await tapReady(driver, target);
      } else if (command == 'tap-text-in') {
        await tapReady(
          driver,
          find.descendant(
            of: find.byType(args[2]),
            matching: find.text(args[3]),
          ),
          timeout: const Duration(seconds: 10),
        );
      } else if (command == 'tap-tooltip-in') {
        await tapReady(
          driver,
          find.descendant(
            of: find.byType(args[2]),
            matching: PosTooltipFinder(args[3]),
          ),
          timeout: const Duration(seconds: 10),
        );
      } else if (command == 'tap-tooltip') {
        await tapReady(
          driver,
          PosTooltipFinder(args[2]),
          timeout: const Duration(seconds: 10),
        );
      } else if (command == 'tap-key') {
        await tapReady(
          driver,
          find.byValueKey(args[2]),
          timeout: const Duration(seconds: 10),
        );
      } else if (command == 'tap-label') {
        await driver.setSemantics(true);
        await tapReady(
          driver,
          find.bySemanticsLabel(args[2]),
          timeout: const Duration(seconds: 10),
        );
      } else if (command == 'wait-type') {
        await driver.waitFor(
          find.byType(args[2]),
          timeout: const Duration(seconds: 90),
        );
      } else if (command == 'scroll-tooltip') {
        final target = PosTooltipFinder(args[2]);
        await driver.waitFor(target, timeout: const Duration(seconds: 10));
        await driver.scrollIntoView(
          target,
          alignment: .5,
          timeout: const Duration(seconds: 10),
        );
        await driver.requestData('frame');
      } else if (command == 'scroll-container-in') {
        final target = find.descendant(
          of: find.byType(args[2]),
          matching: find.byType(args[3]),
        );
        await driver.waitFor(target, timeout: const Duration(seconds: 10));
        await driver.scroll(
          target,
          0,
          double.parse(args[4]),
          const Duration(milliseconds: 300),
          timeout: const Duration(seconds: 10),
        );
        await driver.requestData('frame');
      } else if (command == 'scroll-container') {
        final target = find.byType(args[2]);
        await driver.waitFor(target, timeout: const Duration(seconds: 10));
        await driver.scroll(
          target,
          0,
          double.parse(args[3]),
          const Duration(milliseconds: 300),
          timeout: const Duration(seconds: 10),
        );
        await driver.requestData('frame');
      } else if (command == 'scroll-grid') {
        await driver.scrollUntilVisible(
          find.byType(args.length > 3 ? args[3] : 'GridView'),
          find.text(args[2]),
          dyScroll: -300,
          alignment: .5,
          timeout: const Duration(seconds: 10),
        );
        await driver.requestData('frame');
      } else if (command == 'scroll-detail') {
        await driver.scrollUntilVisible(
          find.descendant(
            of: find.byType('_Detail'),
            matching: find.byType('ListView'),
          ),
          find.text(args[2]),
          dyScroll: args.length > 3 ? double.parse(args[3]) : -260,
          alignment: .5,
          timeout: const Duration(seconds: 10),
        );
        await driver.requestData('frame');
      } else if (command == 'scroll') {
        await driver.scrollIntoView(
          find.text(args[2]),
          alignment: .5,
          timeout: const Duration(seconds: 10),
        );
        await driver.requestData('frame', timeout: const Duration(seconds: 3));
      } else if (command == 'wait') {
        await driver.waitFor(
          find.text(args[2]),
          timeout: const Duration(seconds: 20),
        );
      } else if (command == 'enroll') {
        final payload =
            jsonDecode(
                  File('.estacion-runtime/enrollment.json').readAsStringSync(),
                )
                as Map<String, dynamic>;
        await tapReady(
          driver,
          find.byType('EditableText'),
          timeout: const Duration(seconds: 10),
        );
        await driver.enterText(payload['setupCode'] as String);
        await driver.requestData('frame', timeout: const Duration(seconds: 3));
        await tapReady(
          driver,
          find.text('Continuar'),
          timeout: const Duration(seconds: 10),
        );
        await driver.waitFor(
          find.text('Se requiere la aprobación del administrador'),
          timeout: const Duration(seconds: 15),
        );
      } else if (command == 'fixture-login' ||
          command == 'fixture-login-timed') {
        final payload =
            jsonDecode(
                  File('.estacion-runtime/enrollment.json').readAsStringSync(),
                )
                as Map<String, dynamic>;
        if (payload['base'] != 'http://127.0.0.1:4013') {
          throw StateError('Esta acción exige el entorno desechable');
        }
        await driver.waitFor(
          find.text('Ingresa tu PIN de operador'),
          timeout: const Duration(seconds: 20),
        );
        await driver.setSemantics(true);
        await tapReady(
          driver,
          find.bySemanticsLabel('Borrar todo'),
          timeout: const Duration(seconds: 10),
        );
        await driver.requestData('frame', timeout: const Duration(seconds: 3));
        for (var digit = 0; digit < 4; digit++) {
          await tapReady(
            driver,
            find.text('1'),
            timeout: const Duration(seconds: 10),
          );
          await driver.requestData(
            'frame',
            timeout: const Duration(seconds: 3),
          );
        }
        await driver.requestData('frame', timeout: const Duration(seconds: 3));
        final watch = Stopwatch()..start();
        await tapReady(
          driver,
          find.text('Continuar'),
          timeout: const Duration(seconds: 10),
        );
        if (command == 'fixture-login-timed') {
          final folder = Directory(args[2])..createSync(recursive: true);
          await File(
            '${folder.path}/intermediate.png',
          ).writeAsBytes(await driver.screenshot());
        }
        await driver.waitFor(
          find.byType('CatalogSurface'),
          timeout: const Duration(seconds: 90),
        );
        if (command == 'fixture-login-timed') {
          final shellMs = watch.elapsedMilliseconds;
          await driver.waitFor(
            find.text('Cappuccino'),
            timeout: const Duration(seconds: 90),
          );
          watch.stop();
          final folder = Directory(args[2]);
          await File('${folder.path}/timing.json').writeAsString(
            jsonEncode({
              'scope':
                  'API 4013, fixture UmiPOS Local, cuatro pulsaciones del PIN publicado',
              'start': 'pulsación Continuar',
              'shellMountedMs': shellMs,
              'productVisibleMs': watch.elapsedMilliseconds,
              'mode':
                  '${args.length > 3 ? args[3] : 'unspecified'}, Linux, Flutter Driver',
              'limitations':
                  'Cronómetro de tarea. No mide cuadros ni equivale a una prueba humana.',
            }),
          );
          stdout.writeln(
            'Acceso observado: ${watch.elapsedMilliseconds} ms hasta producto visible',
          );
        }
      } else if (command == 'enter') {
        await tapReady(
          driver,
          find.byValueKey(args[2]),
          timeout: const Duration(seconds: 10),
        );
        await driver.enterText(args[3]);
      } else if (command == 'enter-label') {
        final field = PosEditableFieldFinder(args[2]);
        await tapReady(driver, field, timeout: const Duration(seconds: 10));
        await driver.requestData('frame', timeout: const Duration(seconds: 3));
        await driver.enterText(args[3]);
        await driver.requestData('frame', timeout: const Duration(seconds: 3));
        if (await driver.getText(field) != args[3]) {
          throw StateError('El campo no conserva el texto de prueba');
        }
      } else if (command == 'locate-label') {
        await driver.setSemantics(true);
        final point = await driver.getCenter(find.bySemanticsLabel(args[2]));
        stdout.writeln(jsonEncode({'x': point.dx, 'y': point.dy}));
      } else if (command == 'locate-key' || command == 'locate-type') {
        final target = command == 'locate-key'
            ? find.byValueKey(args[2])
            : find.byType(args[2]);
        final top = await driver.getTopLeft(target);
        final bottom = await driver.getBottomRight(target);
        stdout.writeln(
          jsonEncode({
            'method': 'Flutter Driver getOffset from the native render object',
            'target': args[2],
            'left': top.dx,
            'top': top.dy,
            'right': bottom.dx,
            'bottom': bottom.dy,
          }),
        );
      } else if (command == 'text-scaling') {
        stdout.writeln(await driver.requestData('text-scaling'));
      } else if (command == 'text-field') {
        stdout.writeln(await driver.getText(find.byType('EditableText')));
      } else if (command == 'enter-field') {
        final field = find.byType('EditableText');
        await tapReady(driver, field);
        await driver.requestData('frame');
        await driver.enterText(args[2]);
        await driver.requestData('frame');
        stdout.writeln(await driver.getText(field));
      } else if (command == 'snapshot') {
        final folder = Directory(
          args.length > 2 ? args[2] : '/tmp/estacion-native',
        );
        folder.createSync(recursive: true);
        await File(
          '${folder.path}/screen.png',
        ).writeAsBytes(await driver.screenshot());
        final tree = await driver.getRenderObjectDiagnostics(
          find.byType('PosApp'),
          subtreeDepth: 12,
          includeProperties: true,
        );
        await File(
          '${folder.path}/render-tree.json',
        ).writeAsString(const JsonEncoder.withIndent('  ').convert(tree));
        stdout.writeln('Native snapshot: ${folder.path}');
      } else if (command == 'text') {
        stdout.writeln(await driver.getText(find.byValueKey(args[2])));
      } else {
        throw ArgumentError.value(command, 'command', 'Unknown driver command');
      }
    });
  } finally {
    try {
      await driver.setTextEntryEmulation(enabled: false);
    } finally {
      await driver.close();
    }
  }
}

// Flutter Driver's server timeout does not cancel its source future. Waits may
// finish later, so an absent-target tap must never be sent to the extension.
// Presence checks are observers; the mutation is sent only after one succeeds.
Future<void> tapReady(
  FlutterDriver driver,
  SerializableFinder finder, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  await driver.waitForTappable(finder, timeout: timeout);
  await driver.tap(finder, timeout: const Duration(seconds: 3));
  await driver.requestData('frame', timeout: const Duration(seconds: 3));
}
