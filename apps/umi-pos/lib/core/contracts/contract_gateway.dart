import 'package:umi_contract/umi_contract.dart';

abstract interface class ContractGateway {
  String get version;
  String get contentHash;
  bool get isCompatible;
}

final class GeneratedContractGateway implements ContractGateway {
  const GeneratedContractGateway();

  static const supportedMajor = 2;

  @override
  String get version => contractVersion;

  @override
  String get contentHash => contractContentHash;

  @override
  bool get isCompatible =>
      int.tryParse(contractVersion.split('.').first) == supportedMajor;
}
