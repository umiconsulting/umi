// Generated test fixture. Do not edit.

final class _UmiAbsentMap implements Map<String, Object?> {
  const _UmiAbsentMap();
  @override
  dynamic noSuchMethod(Invocation invocation) => throw StateError('Absent map');
}
const _umiAbsentMap = _UmiAbsentMap();

final class _UmiAbsentList implements List<Never> {
  const _UmiAbsentList();
  @override
  dynamic noSuchMethod(Invocation invocation) => throw StateError('Absent list');
}
const _umiAbsentList = _UmiAbsentList();

final class OptionalCollectionFixture {
  final Map<String, Object?>? configuration;
  final List<String>? values;
  final List<Map<String, Object?>>? rows;
  final bool _has_configuration;
  final bool _has_values;
  final bool _has_rows;

  const OptionalCollectionFixture({
    Map<String, Object?>? configuration = _umiAbsentMap,
    List<String>? values = _umiAbsentList,
    List<Map<String, Object?>>? rows = _umiAbsentList,
  }) : configuration = identical(configuration, _umiAbsentMap) ? null : configuration,
       _has_configuration = !identical(configuration, _umiAbsentMap),
       values = identical(values, _umiAbsentList) ? null : values,
       _has_values = !identical(values, _umiAbsentList),
       rows = identical(rows, _umiAbsentList) ? null : rows,
       _has_rows = !identical(rows, _umiAbsentList);

  factory OptionalCollectionFixture.fromJson(Map<String, Object?> json) => OptionalCollectionFixture(
      configuration: json.containsKey("configuration") ? (json["configuration"] == null ? null : json["configuration"] as Map<String, Object?>) : _umiAbsentMap,
      values: json.containsKey("values") ? (json["values"] == null ? null : (json["values"] as List<Object?>).cast<String>()) : _umiAbsentList,
      rows: json.containsKey("rows") ? (json["rows"] == null ? null : (json["rows"] as List<Object?>).cast<Map<String, Object?>>()) : _umiAbsentList,
  );

  Map<String, Object?> toJson() => {
      if (_has_configuration) "configuration": configuration,
      if (_has_values) "values": values,
      if (_has_rows) "rows": rows,
  };
}
