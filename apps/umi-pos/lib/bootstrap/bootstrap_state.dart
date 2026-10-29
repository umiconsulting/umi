enum BootstrapPhase {
  initializing,
  configurationInvalid,
  storageUnavailable,
  sdkUnavailable,
  readyForAuthentication,
  recoverableFailure,
  unrecoverableFailure,
}

final class BootstrapState {
  const BootstrapState(
    this.phase, {
    this.correlationId,
    this.diagnosticCategory,
    this.diagnosticCode,
  });

  const BootstrapState.initializing() : this(BootstrapPhase.initializing);

  final BootstrapPhase phase;
  final String? correlationId;
  final String? diagnosticCategory;
  final String? diagnosticCode;

  bool get canRetry =>
      phase == BootstrapPhase.recoverableFailure ||
      phase == BootstrapPhase.storageUnavailable;
}
