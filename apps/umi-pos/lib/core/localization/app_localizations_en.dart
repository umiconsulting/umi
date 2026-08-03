// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'UmiPOS';

  @override
  String get bootstrapLoadingTitle => 'Preparing UmiPOS';

  @override
  String get bootstrapLoadingBody =>
      'Checking configuration and secure storage.';

  @override
  String get readyTitle => 'Ready to begin';

  @override
  String get readyBody =>
      'The UmiPOS foundation is ready. Authentication will be enabled in the next step.';

  @override
  String get configurationInvalidTitle => 'Configuration incomplete';

  @override
  String get configurationInvalidBody =>
      'UmiPOS cannot start safely with this configuration.';

  @override
  String get storageUnavailableTitle => 'Secure storage unavailable';

  @override
  String get storageUnavailableBody =>
      'Credentials will not be stored in unencrypted storage.';

  @override
  String get sdkUnavailableTitle => 'Contract unavailable';

  @override
  String get sdkUnavailableBody =>
      'The app could not verify the platform contract.';

  @override
  String get recoverableFailureTitle => 'Preparation could not finish';

  @override
  String get unrecoverableFailureTitle => 'UmiPOS needs attention';

  @override
  String get retryAction => 'Retry';

  @override
  String get diagnosticsAction => 'View diagnostics';

  @override
  String get diagnosticsTitle => 'Development diagnostics';

  @override
  String get unknownRouteTitle => 'Route unavailable';

  @override
  String get unknownRouteBody => 'This area is not enabled yet.';

  @override
  String get enrollmentTitle => 'Enroll this device';

  @override
  String get enrollmentBody =>
      'Enter the eight-character setup code shown by your administrator.';

  @override
  String get challengeIdLabel => 'Challenge ID';

  @override
  String get enrollmentCodeLabel => 'Enrollment code';

  @override
  String get enrollmentCodeInvalid =>
      'Enter the complete eight-character setup code. Your operator PIN is used after device approval.';

  @override
  String get enrollmentCodeRejected =>
      'The setup code is invalid or expired. Request a new code from an administrator.';

  @override
  String get enrollmentCodeExpired =>
      'The setup code expired. Request a new code from an administrator.';

  @override
  String get enrollmentCodeAttemptsExceeded =>
      'This setup request reached its attempt limit. Request a new code from an administrator.';

  @override
  String get enrollmentCodeRateLimited =>
      'Too many attempts were made. Wait before you try again.';

  @override
  String get enrollmentCodeUnavailable =>
      'UmiPOS cannot verify this code now. Check the connection and try again.';

  @override
  String get enrollmentPendingTitle => 'Administrator approval required';

  @override
  String get enrollmentPendingBody =>
      'This device requested access. Ask an administrator to review it in the UMI Dashboard.';

  @override
  String get enrollmentPendingSecure =>
      'The pairing credential is stored securely on this device.';

  @override
  String get cancelEnrollmentAction => 'Cancel request';

  @override
  String get continueAction => 'Continue';

  @override
  String get loginTitle => 'Sign in to UmiPOS';

  @override
  String get usernameLabel => 'Email';

  @override
  String get passwordLabel => 'Password';

  @override
  String get signInAction => 'Sign in';

  @override
  String get operatorPinTitle => 'Enter your operator PIN';

  @override
  String get operatorPinBody =>
      'Your PIN identifies you and loads your current permissions.';

  @override
  String get operatorPinLabel => 'Operator PIN';

  @override
  String get operatorPinHint => 'Use 4 to 8 digits.';

  @override
  String get operatorPinAction => 'Continue';

  @override
  String get operatorPinInvalid => 'The PIN is not valid for this branch.';

  @override
  String get operatorPinLocked =>
      'PIN entry is temporarily locked. Try again later.';

  @override
  String get operatorPinRateLimited =>
      'Too many attempts. Wait before you try again.';

  @override
  String get operatorPinEntitlementDisabled =>
      'UmiPOS is not enabled for this business.';

  @override
  String get operatorPinBranchInvalid =>
      'This device is not assigned to an active branch.';

  @override
  String get operatorPinLength => 'Enter at least four digits.';

  @override
  String get selectTenantTitle => 'Select a business';

  @override
  String get noTenantTitle => 'No business access';

  @override
  String get noTenantBody => 'Your account does not have active UmiPOS access.';

  @override
  String get selectBranchTitle => 'Select a branch';

  @override
  String get noBranchBody =>
      'No active branch intersects your user and device assignments.';

  @override
  String get operatorTitle => 'Start operator session';

  @override
  String get operatorBody =>
      'Confirm this branch to enter the protected POS shell.';

  @override
  String get startOperatorAction => 'Start session';

  @override
  String get lockAction => 'Lock operator';

  @override
  String get logoutAction => 'Sign out';

  @override
  String get deviceActiveLabel => 'Trusted device';

  @override
  String get connectivityUnknownLabel => 'Connectivity unknown';

  @override
  String get shellReadyTitle => 'Operator session ready';

  @override
  String get catalogNotImplemented => 'Catalog is not implemented yet.';

  @override
  String get deviceRevokedTitle => 'Device revoked';

  @override
  String get deviceRevokedBody =>
      'This installation is no longer trusted. Ask an administrator to replace it.';

  @override
  String get rotationRequiredTitle => 'Credential rotation required';

  @override
  String get rotationRequiredBody =>
      'An administrator must rotate this device credential before entry.';

  @override
  String get recoverableNetworkBody =>
      'The trusted entry service could not be reached safely.';

  @override
  String get catalogTitle => 'Catalog';

  @override
  String get catalogSearchHint => 'Search name, SKU or barcode';

  @override
  String get allCategories => 'All';

  @override
  String get catalogLoading => 'Loading authoritative catalog';

  @override
  String get catalogEmpty => 'No products are available for this branch.';

  @override
  String get catalogNoResults => 'No products match this search.';

  @override
  String get catalogPermissionDenied =>
      'You do not have permission to view this catalog.';

  @override
  String get catalogNetworkError =>
      'The catalog could not be reached. Try again safely.';

  @override
  String get catalogUnexpectedError =>
      'The catalog is temporarily unavailable.';

  @override
  String get unavailableLabel => 'Unavailable';

  @override
  String get variantsLabel => 'Variants';

  @override
  String get modifiersLabel => 'Modifiers';

  @override
  String get taxIncludedLabel => 'Tax configured';

  @override
  String get closeAction => 'Close';

  @override
  String get cartTitle => 'Current cart';

  @override
  String get cartEmpty => 'Open a product to begin this cart.';

  @override
  String get cartUnavailable => 'The cart is temporarily unavailable.';

  @override
  String get cartNoteLabel => 'Operator note';

  @override
  String get addToCartAction => 'Add to cart';

  @override
  String get removeFromCartAction => 'Remove line';

  @override
  String get increaseQuantity => 'Increase quantity';

  @override
  String get decreaseQuantity => 'Decrease quantity';

  @override
  String get subtotalLabel => 'Subtotal';

  @override
  String get taxLabel => 'Taxes';

  @override
  String get discountLabel => 'Discount';

  @override
  String get totalLabel => 'Total';

  @override
  String get businessDateLabel => 'Business date';

  @override
  String get checkoutNextGate => 'Checkout available in the next Gate';

  @override
  String get checkoutAction => 'Checkout';

  @override
  String get checkoutTitle => 'Authoritative checkout';

  @override
  String get operatorLabel => 'Operator';

  @override
  String get paymentMethodLabel => 'Payment method';

  @override
  String get cashPayment => 'Cash';

  @override
  String get externalTerminalPayment => 'External terminal';

  @override
  String get reviewTotalsAction => 'Review authoritative totals';

  @override
  String get confirmAndPayAction => 'Confirm and pay';

  @override
  String get confirmAction => 'Confirm';

  @override
  String get confirmSaleTitle => 'Confirm this sale?';

  @override
  String get confirmSaleBody =>
      'The displayed totals were recalculated by UMI. This confirmation starts payment.';

  @override
  String get totalsConfirmedBody =>
      'UMI recalculated this cart. Review every total before confirming payment.';

  @override
  String get paymentProcessing => 'Payment is processing';

  @override
  String get paymentUnknownTitle => 'Payment status unknown';

  @override
  String get paymentUnknownBody =>
      'Do not start a new payment. Query this payment status or ask a manager for help.';

  @override
  String get queryPaymentAction => 'Query payment status';

  @override
  String get correlationLabel => 'Correlation';

  @override
  String get saleCompletedTitle => 'Sale completed';

  @override
  String get finishSaleAction => 'Finish and start a new cart';

  @override
  String get checkoutFailed => 'Checkout could not be completed safely.';

  @override
  String get provisionalSalePendingTitle => 'Sale pending synchronization';

  @override
  String get provisionalSalePendingBody =>
      'Sale saved securely on this device and pending synchronization. Official receipt data will be assigned after server acceptance.';

  @override
  String get returnToCatalogAction => 'Return to catalog';

  @override
  String get recoveryCenterTitle => 'Recovery Center';

  @override
  String get recoveryWebUnsupportedTitle =>
      'Offline recovery is not available on Web';

  @override
  String get recoveryWebUnsupportedBody =>
      'The Web version operates online. Use a supported native app to store and recover offline sales securely.';

  @override
  String get synchronizingPendingSales => 'Synchronizing pending sales…';

  @override
  String get pendingSalesSecure =>
      'Your pending sales remain securely stored on this device.';

  @override
  String get synchronizeNowAction => 'Synchronize now';

  @override
  String get conflictNeedsAttention => 'One sale needs your attention.';

  @override
  String get officialReceiptAvailable => 'Official receipt available';

  @override
  String get cashReceivedLabel => 'Cash received';

  @override
  String get tenderSelectionTitle => 'Payment selection';

  @override
  String get cashTenderTitle => 'Cash';

  @override
  String get tenderAmountLabel => 'Amount applied';

  @override
  String get exactAmountAction => 'Exact amount';

  @override
  String get manualTerminalLabel => 'Manual terminal';

  @override
  String get terminalProcessingAction => 'Processing externally';

  @override
  String get terminalSuccessAction => 'Confirm success';

  @override
  String get terminalFailureAction => 'Report failure';

  @override
  String get terminalUnknownAction => 'Outcome unknown';

  @override
  String get tipLabel => 'Tip';

  @override
  String get noTipAction => 'No tip';

  @override
  String get customTipPercentLabel => 'Custom tip percent';

  @override
  String get customTipFixedLabel => 'Custom tip amount';

  @override
  String get percentageDiscountAction => 'Percentage';

  @override
  String get fixedDiscountAction => 'Fixed amount';

  @override
  String get discountPercentLabel => 'Discount percent';

  @override
  String get discountAmountLabel => 'Discount amount';

  @override
  String get discountReasonLabel => 'Discount reason';

  @override
  String get receiptDestinationLabel => 'Receipt destination';

  @override
  String get displayReceiptAction => 'Display receipt';

  @override
  String get printLaterAction => 'Print later';

  @override
  String get noReceiptAction => 'No receipt';

  @override
  String get managerApprovalAction => 'Request manager approval';

  @override
  String get managerApprovalTitle => 'Manager approval required';

  @override
  String get managerPinLabel => 'Manager PIN';

  @override
  String get managerApprovalDeniedMessage =>
      'The manager PIN or permission is not valid for this checkout.';

  @override
  String get approveAction => 'Approve';

  @override
  String get insufficientCashMessage =>
      'The cash received does not cover the applied cash amount.';

  @override
  String get remainingBalanceMessage =>
      'Add a tender for the remaining balance.';

  @override
  String get approvalRequiredMessage => 'A manager must approve this checkout.';

  @override
  String get terminalFailureMessage =>
      'The terminal payment failed. Review the tenders.';

  @override
  String get tipRejectedMessage => 'The branch tip policy rejected this tip.';

  @override
  String get discountRejectedMessage =>
      'The branch discount policy rejected this discount.';

  @override
  String get changeDueLabel => 'Change due';

  @override
  String get appliedAmountLabel => 'Applied amount';

  @override
  String get remainingBalanceLabel => 'Remaining balance';

  @override
  String get offlineAdvancedTenderBlockedMessage =>
      'Reconnect to use manual terminal, mixed payment, tips, or discounts. The sale is preserved.';

  @override
  String get recoveryQueryTitle => 'Check saved result';

  @override
  String get recoveryQueryDescription =>
      'Ask UMI whether this exact operation was already accepted.';

  @override
  String get recoveryPolicyTitle => 'Refresh offline policy';

  @override
  String get recoveryPolicyDescription =>
      'Reconnect to load current server permission for offline sales.';

  @override
  String get recoveryAuthenticationTitle => 'Sign in again';

  @override
  String get recoveryAuthenticationDescription =>
      'Restore your authorized session before synchronization continues.';

  @override
  String get recoveryBranchTitle => 'Select the authorized branch';

  @override
  String get recoveryBranchDescription =>
      'Return to branch selection without moving pending sales.';

  @override
  String get recoveryManagerTitle => 'Request manager review';

  @override
  String get recoveryManagerDescription =>
      'Verify an authorized manager for this recovery action only.';

  @override
  String get recoveryManagerCredentialLabel => 'Manager PIN';

  @override
  String get recoveryAcknowledgeTitle => 'Confirm reconciliation';

  @override
  String get recoveryAcknowledgeDescription =>
      'Acknowledge the server reconciliation only after local recovery is durable.';

  @override
  String get recoveryReceiptTitle => 'View receipt status';

  @override
  String get recoveryReceiptDescription =>
      'Open the preserved provisional or official receipt status.';

  @override
  String get recoveryPaymentTitle => 'Check original payment';

  @override
  String get recoveryPaymentDescription =>
      'Query the original payment only. No new charge will be started.';

  @override
  String get recoveryDeviceTitle => 'Verify this device';

  @override
  String get recoveryDeviceDescription =>
      'This device is blocked. Restore authority before any replay.';

  @override
  String get recoveryCredentialTitle => 'Recover rotated credentials';

  @override
  String get recoveryCredentialDescription =>
      'Historical commands stay bound to their original credential version.';

  @override
  String get recoveryStorageTitle => 'Preserve storage for recovery';

  @override
  String get recoveryStorageDescription =>
      'Keep encrypted data intact and follow authorized support recovery.';

  @override
  String get recoverySnapshotTitle => 'Refresh authoritative data';

  @override
  String get recoverySnapshotDescription =>
      'Reconnect to refresh expired catalog, price, and tax snapshots.';

  @override
  String get recoverySupportTitle => 'Copy support reference';

  @override
  String get recoverySupportDescription =>
      'Copy the safe diagnostic reference without exposing sale contents.';

  @override
  String get saleActionsTitle => 'Sale actions';

  @override
  String get newSaleAction => 'New sale';

  @override
  String get suspendSaleAction => 'Suspend sale';

  @override
  String get resumeSaleAction => 'Resume sale';

  @override
  String get renameSaleAction => 'Rename suspended sale';

  @override
  String get cancelSaleAction => 'Cancel sale';

  @override
  String get suspendedSaleLabel => 'Suspended sale name';

  @override
  String get cancelSaleReasonLabel => 'Cancellation reason';

  @override
  String get confirmCancelSaleTitle => 'Cancel this sale?';

  @override
  String get confirmCancelSaleBody =>
      'The cart will close without payment or receipt. The cancellation remains in the audit history.';

  @override
  String get saleRestoredMessage => 'Your active sale was restored.';

  @override
  String get readyForNextCustomerMessage => 'Ready for the next customer.';

  @override
  String get currentCustomerLabel => 'Current customer';

  @override
  String get anonymousCustomerLabel => 'Anonymous customer';

  @override
  String get attachCustomerAction => 'Attach customer';

  @override
  String get detachCustomerAction => 'Use anonymous customer';

  @override
  String get searchCustomerHint => 'Search customers';

  @override
  String get recentCustomersAction => 'Recent customers';

  @override
  String get saleHistoryTitle => 'Sales';

  @override
  String get currentSaleLabel => 'Current sale';

  @override
  String get suspendedSalesLabel => 'Suspended sales';

  @override
  String get committedSalesLabel => 'Recent completed sales';

  @override
  String get cancelledSalesLabel => 'Cancelled sales';

  @override
  String get saleHistoryEmpty => 'No sales match this view.';

  @override
  String get sortNewestLabel => 'Newest first';

  @override
  String get sortOldestLabel => 'Oldest first';

  @override
  String get loadMoreSalesAction => 'Load more sales';

  @override
  String get saleStateBuilding => 'In progress';

  @override
  String get saleStateSuspended => 'Suspended';

  @override
  String get saleStateCommitted => 'Completed';

  @override
  String get saleStateCancelled => 'Cancelled';

  @override
  String get saleStateRecovered => 'Recovered';

  @override
  String get openReceiptAction => 'Open receipt';

  @override
  String get reprintReceiptAction => 'Reprint view';

  @override
  String get receiptAvailableMessage => 'Receipt available';

  @override
  String get saleLifecycleError =>
      'The sale action could not be completed safely.';

  @override
  String get saleSearchHint => 'Search by name, customer, or receipt';

  @override
  String get saleNameFallback => 'Sale';

  @override
  String get editCartLineAction => 'Edit item';

  @override
  String get saveCartLineAction => 'Save changes';

  @override
  String get clearCartAction => 'Clear cart';

  @override
  String get confirmClearCartTitle => 'Clear this cart?';

  @override
  String get confirmClearCartBody =>
      'All items will be removed from the current sale.';

  @override
  String get cashCenterTitle => 'Cash Center';

  @override
  String get cashCenterAction => 'Open Cash Center';

  @override
  String get registerAvailableLabel => 'Register available';

  @override
  String get registerAssignedLabel => 'Assigned register';

  @override
  String get shiftRequiredMessage =>
      'Open a cash shift before you accept cash.';

  @override
  String get openShiftAction => 'Open cash shift';

  @override
  String get openingFloatLabel => 'Opening float';

  @override
  String get denominationCountLabel => 'Denomination count';

  @override
  String get paidInAction => 'Paid In';

  @override
  String get paidOutAction => 'Paid Out';

  @override
  String get safeDropAction => 'Safe Drop';

  @override
  String get drawerCorrectionAction => 'Drawer correction';

  @override
  String get noSaleDrawerAction => 'Request drawer opening';

  @override
  String get drawerRequestRecordedMessage =>
      'The drawer opening request was recorded. Hardware operation is not verified.';

  @override
  String get suspendShiftAction => 'Suspend shift';

  @override
  String get resumeShiftAction => 'Resume shift';

  @override
  String get handoffShiftAction => 'Hand off shift';

  @override
  String get incomingOperatorPinLabel => 'Incoming operator PIN';

  @override
  String get blindCountAction => 'Start blind count';

  @override
  String get recountAction => 'Start recount';

  @override
  String get expectedCashLabel => 'Expected cash';

  @override
  String get countedCashLabel => 'Counted cash';

  @override
  String get cashVarianceLabel => 'Variance';

  @override
  String get cashOverageLabel => 'Overage';

  @override
  String get cashShortageLabel => 'Shortage';

  @override
  String get cashToleranceLabel => 'Tolerance';

  @override
  String get varianceReasonLabel => 'Variance reason';

  @override
  String get cashApprovalAction => 'Request variance approval';

  @override
  String get reconcileShiftAction => 'Reconcile shift';

  @override
  String get closeShiftAction => 'Close shift';

  @override
  String get shiftClosedMessage => 'The cash shift is closed.';

  @override
  String get blockedShiftMessage =>
      'This shift is blocked. Follow the recovery guidance.';

  @override
  String get pendingCashPostingMessage =>
      'A pending cash posting must finish before close.';

  @override
  String get ambiguousCashEffectMessage =>
      'A cash effect is unknown. Verify the original operation.';

  @override
  String get cashRecoveryMessage =>
      'The saved cash operation state was restored.';

  @override
  String get shiftSummaryTitle => 'Shift summary';

  @override
  String get cashMovementAmountLabel => 'Movement amount';

  @override
  String get cashMovementReasonLabel => 'Movement reason';

  @override
  String get submitCashMovementAction => 'Confirm cash movement';

  @override
  String get submitBlindCountAction => 'Submit blind count';

  @override
  String get cashOperationFailedMessage =>
      'The cash operation could not complete safely.';

  @override
  String get cashStatusOpen => 'Shift open';

  @override
  String get cashStatusSuspended => 'Shift suspended';

  @override
  String get cashStatusCounting => 'Cash count in progress';

  @override
  String get cashStatusReconciliation => 'Reconciliation required';

  @override
  String get cashStatusClosed => 'Shift closed';

  @override
  String get confirmCloseShiftTitle => 'Close this cash shift?';

  @override
  String get confirmCloseShiftBody =>
      'The close is final. New cash postings will require a new shift.';

  @override
  String get varianceReasonNone => 'No variance';

  @override
  String get varianceReasonCounting => 'Counting error';

  @override
  String get varianceReasonChange => 'Change error';

  @override
  String get varianceReasonHandling => 'Cash handling error';

  @override
  String get varianceReasonUnknown => 'Operational difference';

  @override
  String get saleExceptionAction => 'Post-sale actions';

  @override
  String get saleExceptionTitle => 'Refund or void';

  @override
  String get fullRefundAction => 'Full refund';

  @override
  String get partialRefundAction => 'Partial refund';

  @override
  String get voidSaleAction => 'Void sale';

  @override
  String get refundableAmountLabel => 'Remaining refundable amount';

  @override
  String get remainingRefundableQuantityLabel => 'Remaining quantity';

  @override
  String get alreadyRefundedLabel => 'Already refunded';

  @override
  String get refundReasonLabel => 'Refund reason';

  @override
  String get restockAction => 'Restock';

  @override
  String get doNotRestockAction => 'Do not restock';

  @override
  String get inspectionRequiredAction => 'Inspection required';

  @override
  String get taxRefundLabel => 'Tax refund';

  @override
  String get discountAllocationLabel => 'Discount allocation';

  @override
  String get tipRefundLabel => 'Tip refund';

  @override
  String get cashRefundLabel => 'Cash refund';

  @override
  String get manualTerminalRefundLabel => 'Manual terminal refund';

  @override
  String get manualTerminalRefundProviderNotice =>
      'Process the refund in the external terminal. UmiPOS records your observation. It does not prove provider success.';

  @override
  String get approvalExpiredMessage =>
      'The approval expired. Request a new approval.';

  @override
  String get paymentOutcomeUnknownMessage =>
      'The terminal outcome is unknown. Verify the original terminal operation.';

  @override
  String get verifyTerminalAction => 'Verify terminal outcome';

  @override
  String get terminalRefundSuccessAction => 'The external refund succeeded';

  @override
  String get terminalRefundFailureAction => 'The external refund failed';

  @override
  String get terminalRefundUnknownAction => 'The outcome is unknown';

  @override
  String get refundBlockedMessage =>
      'The server blocked this post-sale action.';

  @override
  String get refundPolicyExpiredMessage => 'The refund policy window expired.';

  @override
  String get supportRequiredMessage => 'Support review is required.';

  @override
  String get compensatingReceiptTitle => 'Refund receipt';

  @override
  String get fullyRefundedLabel => 'Fully refunded';

  @override
  String get partiallyRefundedLabel => 'Partially refunded';

  @override
  String get voidedSaleLabel => 'Voided';

  @override
  String get recoveredRefundMessage => 'The saved refund result was restored.';

  @override
  String get refundCommittedMessage => 'The refund was committed.';

  @override
  String get refundPreviewAction => 'Review refund';

  @override
  String get commitRefundAction => 'Commit refund';

  @override
  String get refundConfirmationTitle => 'Commit this refund?';

  @override
  String get refundConfirmationBody =>
      'This action creates permanent compensation facts. The original sale stays unchanged.';

  @override
  String get originalSaleLabel => 'Original sale';

  @override
  String get exceptionHistoryLabel => 'Exception history';

  @override
  String get refundOperationFailedMessage =>
      'The post-sale action could not complete safely.';

  @override
  String get selectRefundLinesMessage => 'Select at least one refundable line.';

  @override
  String get refundReasonCustomerChangedMind => 'Customer changed their mind';

  @override
  String get refundReasonProductDefect => 'Product defect';

  @override
  String get refundReasonIncorrectItem => 'Incorrect item';

  @override
  String get refundReasonIncorrectQuantity => 'Incorrect quantity';

  @override
  String get refundReasonDuplicateCharge => 'Duplicate charge';

  @override
  String get refundReasonQualityIssue => 'Quality issue';

  @override
  String get refundReasonOrderPreparationError => 'Order preparation error';

  @override
  String get refundReasonPricingError => 'Pricing error';

  @override
  String get voidReasonOperatorError => 'Operator error';

  @override
  String get voidReasonDuplicateSale => 'Duplicate sale';

  @override
  String get voidReasonIncorrectTender => 'Incorrect tender';

  @override
  String get voidReasonSaleEnteredByMistake => 'Sale entered by mistake';

  @override
  String get otherApprovedReasonLabel => 'Other approved reason';

  @override
  String get decreaseRefundQuantityTooltip => 'Decrease refund quantity';

  @override
  String get increaseRefundQuantityTooltip => 'Increase refund quantity';

  @override
  String get restockIntentLabel => 'Restock intent';

  @override
  String get restockNotApplicableLabel => 'Restock does not apply';

  @override
  String get restockInventoryReviewLabel => 'Inventory review required';
}
