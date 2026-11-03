import 'package:integration_test/integration_test.dart';

import '../test/features/tables/table_state_surface_test.dart' as tables;

// Ejecuta las acciones del mapa en el cliente nativo con el adaptador de prueba.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  tables.main();
}
