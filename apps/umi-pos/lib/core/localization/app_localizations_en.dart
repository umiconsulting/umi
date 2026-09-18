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
  String get updateAvailableTitle => 'Update available';

  @override
  String get updateRequiredBody =>
      'This version of UmiPOS is no longer supported. Update to continue.';

  @override
  String get updateAction => 'Update now';

  @override
  String get updateInProgress => 'Downloading the update…';

  @override
  String get updateReadyTitle => 'Update ready';

  @override
  String get updateReadyBody => 'Restart UmiPOS to use the new version.';

  @override
  String get updateRestartAction => 'Restart now';

  @override
  String get updateFailedBody =>
      'The update failed. Check your connection and try again.';

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
  String get cartCourseLabel => 'Course';

  @override
  String get cartCoursePrevious => 'Previous course';

  @override
  String get cartCourseNext => 'Next course';

  @override
  String cartCourseCurrent(int course) {
    return 'Course $course';
  }

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
  String get cashTenderTitle => 'Cash applied';

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
  String get invalidTenderMessage =>
      'Check the payment method: this combination cannot be charged. If the terminal already confirmed a payment, it cannot be removed from this order.';

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
  String get incomingOrdersTitle => 'Incoming orders';

  @override
  String get incomingOrdersEmpty => 'No incoming orders.';

  @override
  String get incomingOrdersError => 'Could not load the orders.';

  @override
  String get incomingOrdersTake => 'Take';

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
  String get adoptShiftTitle => 'Your shift is still open on another terminal';

  @override
  String get adoptShiftMessage =>
      'This terminal lost its stored identity. The shift and the cash are still there; bring them to this screen to continue.';

  @override
  String get adoptShiftAction => 'Bring the shift to this terminal';

  @override
  String get reclaimRegisterTitle =>
      'This drawer is held by a terminal that no longer exists';

  @override
  String get reclaimRegisterMessage =>
      'No active terminal holds this drawer. Free it so a shift can be opened on it; the cash is not counted because it is still in the drawer.';

  @override
  String get reclaimRegisterAction => 'Free the drawer';

  @override
  String get cashShiftRequiredMessage =>
      'This charge has no cash shift to book the money against.';

  @override
  String get resumeShiftAndRetryAction => 'Resume shift and retry';

  @override
  String get reclaimRegisterAndRetryAction => 'Free the drawer and retry';

  @override
  String get cashHeldByActiveTillMessage =>
      'Another active terminal holds this drawer. Ask a manager to count it before you continue.';

  @override
  String get openShiftAction => 'Open cash shift';

  @override
  String get invalidAmountMessage =>
      'Enter a valid amount, for example 1,500.00.';

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
  String get manualTerminalRefundOnCommitNotice =>
      'The terminal will be refunded when you confirm.';

  @override
  String get cardTerminalRefundLabel => 'Card terminal refund';

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

  @override
  String get sessionEndedReauth =>
      'Your session ended. Please re-enter your PIN.';

  @override
  String operatorShift(String name) {
    return 'Shift: $name';
  }

  @override
  String get tableStateOpenLabel => 'Open';

  @override
  String get tableStateSeatedLabel => 'Seated';

  @override
  String get tableStateOrderedLabel => 'Order taken';

  @override
  String get tableStateServedLabel => 'Served';

  @override
  String get tableStateAwaitingPaymentLabel => 'Awaiting payment';

  @override
  String get tableStateDirtyLabel => 'Needs cleaning';

  @override
  String tableStatePartySizeLabel(int count) {
    return '$count guests';
  }

  @override
  String tableStateElapsedLabel(String duration) {
    return '$duration at table';
  }

  @override
  String tableStateGroupLabel(int count) {
    return 'Group of $count tables';
  }

  @override
  String get tableStateSeatAction => 'Seat';

  @override
  String tableStateSeatTitle(String table) {
    return 'Seat table $table';
  }

  @override
  String get tableStatePartySizeField => 'Guests';

  @override
  String get tableStateMoveAction => 'Move';

  @override
  String tableStateMoveArmed(String table) {
    return 'Moving $table. Tap a free table.';
  }

  @override
  String get tableStateSplitAction => 'Split';

  @override
  String get tableStateClearAction => 'Clear table';

  @override
  String get tableStateReadyAction => 'Mark ready';

  @override
  String get tableStateOrderedAction => 'Order sent';

  @override
  String get tableStateServedAction => 'Mark served';

  @override
  String get tableStateAwaitingPaymentAction => 'Bill requested';

  @override
  String get tableStateSelectAction => 'Select';

  @override
  String get tableStateMergeAction => 'Merge';

  @override
  String get tableStateSelectHint => 'Select two or more free tables';

  @override
  String tableStateSelectedCount(int count) {
    return '$count selected';
  }

  @override
  String get tableStateMergeTitle => 'Merge tables';

  @override
  String tableStateMergeSummary(int tables, int seats) {
    return '$tables tables · $seats seats';
  }

  @override
  String get tableStateTargetOccupied => 'That table already has a party.';

  @override
  String tableStateTargetTooSmall(int count) {
    return 'That table cannot seat $count guests.';
  }

  @override
  String get tableStateFailureTitle => 'Could not complete';

  @override
  String get tableStateFailureRefresh => 'Refresh map';

  @override
  String get tableStateFailureAlreadyOccupiedMessage =>
      'That table already has a party.';

  @override
  String get tableStateFailureAlreadyOccupiedRecovery =>
      'Pick another table, or refresh the map before trying again.';

  @override
  String get tableStateFailureCapacityExceededMessage =>
      'The party is larger than the table seats.';

  @override
  String get tableStateFailureCapacityExceededRecovery =>
      'Choose a bigger table, or merge two tables.';

  @override
  String get tableStateFailureNotOccupiedMessage =>
      'There is no party on that table.';

  @override
  String get tableStateFailureNotOccupiedRecovery =>
      'Refresh the map: somebody else may have cleared the table.';

  @override
  String get tableStateFailureNotGroupedMessage =>
      'That table is not merged with another.';

  @override
  String get tableStateFailureNotGroupedRecovery =>
      'Only a table inside a group can be split.';

  @override
  String get tableStateFailureNotInPlanMessage =>
      'That table is not in the published floor plan.';

  @override
  String get tableStateFailureNotInPlanRecovery =>
      'Publish the plan from the dashboard, then refresh this view.';

  @override
  String get tableStateFailureIdempotencyConflictMessage =>
      'That change was already sent with different content.';

  @override
  String get tableStateFailureIdempotencyConflictRecovery =>
      'Refresh the map and repeat the action from the current state.';

  @override
  String get tableStateFailurePermissionDeniedMessage =>
      'Your role cannot change tables.';

  @override
  String get tableStateFailurePermissionDeniedRecovery =>
      'Ask a manager to do it, or sign in as another operator.';

  @override
  String get tableStateFailurePlanNotPublishedMessage =>
      'This location has no published floor plan.';

  @override
  String get tableStateFailurePlanNotPublishedRecovery =>
      'Publish the plan from the dashboard to operate its tables.';

  @override
  String get tableStateFailureGenericMessage =>
      'The table action could not be completed.';

  @override
  String get tableStateFailureGenericRecovery =>
      'Refresh the map and try again.';

  @override
  String get tableStateCancelAction => 'Cancel';

  @override
  String get kitchenBoardTitle => 'Kitchen';

  @override
  String get kitchenBoardRefresh => 'Refresh';

  @override
  String get kitchenBoardLoadFailed => 'Could not load the kitchen.';

  @override
  String get kitchenBoardEmpty => 'No kitchen tickets.';

  @override
  String get kitchenBoardTabTickets => 'Tickets';

  @override
  String get kitchenPrepTab => 'Preparation';

  @override
  String get kitchenPrepRefresh => 'Reload prep';

  @override
  String get kitchenPrepLoadFailed => 'Could not load the prep list.';

  @override
  String get kitchenPrepEmpty =>
      'No items have a par yet. Set the par in Inventory.';

  @override
  String kitchenPrepWindow(String from, String to) {
    return 'Forecast usage from $from to $to';
  }

  @override
  String get kitchenPrepItemColumn => 'Item';

  @override
  String get kitchenPrepUnitColumn => 'Unit';

  @override
  String get kitchenPrepParColumn => 'Par';

  @override
  String get kitchenPrepOnHandColumn => 'On hand';

  @override
  String get kitchenPrepForecastColumn => 'Forecast usage';

  @override
  String get kitchenPrepQuantityColumn => 'Quantity to make';

  @override
  String get kitchenPrepNoPar => 'No par';

  @override
  String get kitchenStatusQueued => 'Queued';

  @override
  String get kitchenStatusInPreparation => 'Preparing';

  @override
  String get kitchenStatusPartiallyReady => 'Partial';

  @override
  String get kitchenStatusReady => 'Ready';

  @override
  String get kitchenStatusException => 'Exception';

  @override
  String get kitchenPriorityUrgent => 'Urgent';

  @override
  String get kitchenPriorityHigh => 'High';

  @override
  String get kitchenElapsedNow => 'now';

  @override
  String kitchenElapsedMinutes(int minutes) {
    return '$minutes min';
  }

  @override
  String kitchenElapsedHoursMinutes(int hours, int minutes) {
    return '$hours h $minutes min';
  }

  @override
  String kitchenElapsedDaysHours(int days, int hours) {
    return '$days d $hours h';
  }

  @override
  String kitchenItemMarkReady(String item) {
    return 'Mark $item ready';
  }

  @override
  String kitchenItemAlreadyReady(String item) {
    return '$item is already ready';
  }

  @override
  String kitchenCourseGroup(int course) {
    return 'Course $course';
  }

  @override
  String kitchenCourseHeld(int count) {
    return 'Held · $count';
  }

  @override
  String get kitchenCourseHeldNote => 'Not cooking yet';

  @override
  String kitchenCourseFire(int course) {
    return 'Fire course $course';
  }

  @override
  String kitchenItemHeld(String item) {
    return '$item is not cooking yet';
  }

  @override
  String get kitchenItemVoided => 'VOIDED';

  @override
  String get kitchenTicketStartAction => 'Start';

  @override
  String get kitchenTicketCompleteAction => 'Complete';

  @override
  String get kitchenTicketRecallAction => 'Recall';

  @override
  String get kitchenTicketSending => 'Sending…';

  @override
  String get kitchenRecallTitle => 'Recall ticket';

  @override
  String get kitchenRecallBody =>
      'Why is this ticket coming back to the kitchen?';

  @override
  String get kitchenRecallReasonCustomerReturned => 'The customer sent it back';

  @override
  String get kitchenRecallReasonWrongItem => 'The wrong dish went out';

  @override
  String get kitchenRecallReasonQuality => 'It was not right';

  @override
  String get kitchenRecallReasonOther => 'Another reason';

  @override
  String get kitchenRecallNoteLabel => 'Note (optional)';

  @override
  String get kitchenRecallCancel => 'Cancel';

  @override
  String get kitchenFailureTitle => 'The kitchen did not change';

  @override
  String get kitchenFailureRefresh => 'Refresh kitchen';

  @override
  String kitchenFailureVersionConflictMessage(String reference) {
    return 'Somebody else already moved ticket $reference.';
  }

  @override
  String get kitchenFailureVersionConflictGenericMessage =>
      'Somebody else already moved that ticket.';

  @override
  String get kitchenFailureVersionConflictRecovery =>
      'The board has been refreshed. Check the ticket and mark whatever is still pending.';

  @override
  String kitchenFailureFingerprintMessage(String reference) {
    return 'That change was already sent with different content, for ticket $reference.';
  }

  @override
  String get kitchenFailureFingerprintRecovery =>
      'Refresh the board and repeat the action from the current state.';

  @override
  String get kitchenFailureInvalidTransitionMessage =>
      'The ticket cannot take that step from its current state.';

  @override
  String get kitchenFailureInvalidTransitionRecovery =>
      'Refresh the board. To send a ticket back to the kitchen, use Recall on a ready ticket.';

  @override
  String get kitchenFailurePermissionDeniedMessage =>
      'Your role cannot move the kitchen.';

  @override
  String get kitchenFailurePermissionDeniedRecovery =>
      'Ask a manager to do it, or sign in as another operator.';

  @override
  String kitchenFailureTicketMissingMessage(String reference) {
    return 'Ticket $reference did not reach this device\'s station.';
  }

  @override
  String get kitchenFailureTicketMissingGenericMessage =>
      'That ticket did not reach this device\'s station.';

  @override
  String get kitchenFailureTicketMissingRecovery =>
      'The ticket is still in the kitchen. Refresh the board, and if it keeps happening ask a manager to check that this device is assigned to its station.';

  @override
  String get kitchenFailureDeviceMessage =>
      'This device is no longer registered for the kitchen.';

  @override
  String get kitchenFailureDeviceRecovery =>
      'Enroll this device again from the dashboard.';

  @override
  String get kitchenFailureGenericMessage =>
      'The kitchen action could not be completed.';

  @override
  String get kitchenFailureGenericRecovery =>
      'Refresh the board and try again.';

  @override
  String get terminalChargeTitle => 'Card terminal';

  @override
  String terminalChargeInstruction(String amount) {
    return 'Charge $amount on the terminal and confirm the outcome here.';
  }

  @override
  String get terminalOperatorDeclaration =>
      'The terminal is an operator declaration: the POS does not read its outcome.';

  @override
  String get terminalStatusLabel => 'Status';

  @override
  String get terminalStatusNotStarted => 'Not started';

  @override
  String get terminalStatusProcessing => 'Charging outside the POS';

  @override
  String get terminalStatusConfirmed => 'Charge confirmed';

  @override
  String get terminalStatusFailed => 'Failure reported';

  @override
  String get terminalStatusUnknown => 'Outcome unknown';

  @override
  String get terminalStatusCancelled => 'Cancelled before charging';

  @override
  String get cardTerminalLabel => 'Card terminal';

  @override
  String get terminalWaitingTitle => 'Waiting at the terminal…';

  @override
  String get terminalStopWaitingAction => 'Stop waiting';

  @override
  String get terminalApprovedMessage => 'The terminal approved the charge.';

  @override
  String terminalDeclinedMessage(String code) {
    return 'The terminal refused the charge ($code).';
  }

  @override
  String get terminalUnresolvedMessage =>
      'There is a card payment nobody has confirmed. The sale cannot close until it is resolved.';

  @override
  String get terminalStoppedWaitingMessage =>
      'You stopped waiting: the terminal may still hold the order. The attempt stays recorded and can be queried.';

  @override
  String get terminalLastAnswerLabel => 'Terminal says';

  @override
  String get terminalApprovedCollectMessage =>
      'The terminal approved the charge. Press Charge to close the sale.';

  @override
  String get terminalDeclinedNoChargeMessage =>
      'The terminal declined the charge and nothing was taken. You can take cash, or start a new sale to retry the card.';

  @override
  String get terminalUnavailableMessage =>
      'The card terminal is not available. You can take cash.';

  @override
  String get terminalBusyMessage =>
      'The terminal is busy with another order. Try again.';

  @override
  String get newSaleConfirmTitle => 'Start a new sale?';

  @override
  String newSaleConfirmBody(int count) {
    return 'This cart holds $count unbilled line(s). It is abandoned and an empty sale starts; nothing is charged for it.';
  }

  @override
  String get keepCartAction => 'Keep this cart';

  @override
  String get tenderConflictTitle => 'This cart cannot be paid like this';

  @override
  String get tenderConflictBody =>
      'It holds a split between cash and card, and this location takes one method per sale. The payment record stays for review; to carry on, start a new sale.';

  @override
  String get splitTenderTitle => 'Split payment';

  @override
  String get splitTenderAction => 'Split payment';

  @override
  String get splitTenderCancelAction => 'Single method';

  @override
  String get splitTenderPickSecond => 'Choose the second payment method.';

  @override
  String get singleMethodOnlyNote =>
      'This location charges one method per sale.';

  @override
  String tenderShortBy(String amount) {
    return 'Short by $amount';
  }

  @override
  String tenderOverBy(String amount) {
    return 'Over by $amount';
  }

  @override
  String kitchenAllDayTooltip(int ordered, int outstanding) {
    return 'Ordered today: $ordered. Still to make: $outstanding.';
  }

  @override
  String get inventoryProductionAction => 'Produce';

  @override
  String get inventoryProductionTitle => 'Produce prep';

  @override
  String get inventoryProductionOutputLabel => 'Output item';

  @override
  String get inventoryProductionQuantityLabel => 'Quantity produced';

  @override
  String get inventoryProductionQuantityHelper =>
      'Use the item\'s scale and base unit.';

  @override
  String get inventoryProductionLotLabel => 'Batch code (optional)';

  @override
  String get inventoryProductionExpiryLabel => 'Expiry (optional)';

  @override
  String get inventoryProductionExpiryHint => 'YYYY-MM-DD';

  @override
  String get inventoryProductionResultTitle => 'Produced batch';

  @override
  String get inventoryProductionLotReferenceLabel => 'Batch';

  @override
  String get inventoryProductionExpiryReferenceLabel => 'Expiry';

  @override
  String get inventoryProductionProducedLabel => 'Produced';

  @override
  String get inventoryProductionDeclaredLabel => 'Recipe yield';

  @override
  String get inventoryProductionYieldLossLabel => 'Yield loss';

  @override
  String get inventoryProductionUnitCostLabel => 'Unit cost';

  @override
  String get inventoryProductionTotalCostLabel => 'Batch cost';

  @override
  String get inventoryProductionConsumedTitle => 'Consumed inputs';

  @override
  String get inventoryProductionIncompleteCostMessage =>
      'Some inputs have no recorded cost.';

  @override
  String get inventoryProductionNoCostLabel => 'No cost';

  @override
  String get inventoryProductionRecipeRequiredMessage =>
      'This item has no production recipe.';

  @override
  String get inventoryProductionQuantityNotExactMessage =>
      'The quantity does not divide exactly across the recipe inputs.';

  @override
  String get inventoryProductionInsufficientStockMessage =>
      'There is not enough stock of an input to make this batch.';

  @override
  String get inventoryUnitEach => 'ea';

  @override
  String get inventoryUnitGram => 'g';

  @override
  String get inventoryUnitKilogram => 'kg';

  @override
  String get inventoryUnitMilliliter => 'ml';

  @override
  String get inventoryUnitLiter => 'L';

  @override
  String get inventoryUnitPortion => 'portion';

  @override
  String get inventoryUnitPackage => 'pack';

  @override
  String get inventoryUnitBox => 'box';
}
