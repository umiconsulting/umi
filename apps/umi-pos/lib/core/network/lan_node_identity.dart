/// The signed-in scope of the terminal that owns the LAN node.
final class LanNodeIdentity {
  const LanNodeIdentity({
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
    required this.deviceId,
    required this.credentialVersion,
  });

  final String merchantId;
  final String locationId;
  final String operatorSessionId;
  final String deviceId;
  final int credentialVersion;
}
