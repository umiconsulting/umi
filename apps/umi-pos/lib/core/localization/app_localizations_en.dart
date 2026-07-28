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
      'Enter the one-time challenge approved by an administrator.';

  @override
  String get challengeIdLabel => 'Challenge ID';

  @override
  String get enrollmentCodeLabel => 'Enrollment code';

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
  String get discountLabel => 'Discount preview';

  @override
  String get totalLabel => 'Total';

  @override
  String get businessDateLabel => 'Business date';

  @override
  String get checkoutNextGate => 'Checkout available in the next Gate';
}
