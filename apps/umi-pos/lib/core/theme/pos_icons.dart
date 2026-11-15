import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'pos_control_glyphs.dart';
import 'pos_navigation_glyphs.dart';
import 'pos_theme.dart';

final class PosGlyph {
  const PosGlyph(this.name);
  final String name;
}

abstract final class PosGlyphs {
  static const bank = PosGlyph('bank');
  static const send = PosGlyph('send');
  static const repeat = PosGlyph('repeat');
  static const cashDrawer = PosGlyph('cash_drawer');
  static const assignmentReturnOutlined = PosGlyph(
    'assignment_return_outlined',
  );
  static const accountBalanceWalletOutlined = PosGlyph(
    'account_balance_wallet_outlined',
  );
  static const accountCircleOutlined = PosGlyph('account_circle_outlined');
  static const add = PosGlyph('add');
  static const addCardOutlined = PosGlyph('add_card_outlined');
  static const addCircleOutline = PosGlyph('add_circle_outline');
  static const addShoppingCartOutlined = PosGlyph('add_shopping_cart_outlined');
  static const arrowBack = PosGlyph('arrow_back');
  static const arrowDropDown = PosGlyph('arrow_drop_down');
  static const arrowForward = PosGlyph('arrow_forward');
  static const arrowUpward = PosGlyph('arrow_upward');
  static const assignmentTurnedInOutlined = PosGlyph(
    'assignment_turned_in_outlined',
  );
  static const backspaceOutlined = PosGlyph('backspace_outlined');
  static const badgeOutlined = PosGlyph('badge_outlined');
  static const balanceOutlined = PosGlyph('balance_outlined');
  static const block = PosGlyph('block');
  static const blockOutlined = PosGlyph('block_outlined');
  static const brokenImageOutlined = PosGlyph('broken_image_outlined');
  static const callSplit = PosGlyph('call_split');
  static const cancelOutlined = PosGlyph('cancel_outlined');
  static const cardGiftcard = PosGlyph('card_giftcard');
  static const cardGiftcardOutlined = PosGlyph('card_giftcard_outlined');
  static const check = PosGlyph('check');
  static const checkBox = PosGlyph('check_box');
  static const checkBoxOutlineBlank = PosGlyph('check_box_outline_blank');
  static const checkBoxOutlined = PosGlyph('check_box_outlined');
  static const checkCircle = PosGlyph('check_circle');
  static const checkCircleOutline = PosGlyph('check_circle_outline');
  static const chevronRight = PosGlyph('chevron_right');
  static const cleaningServices = PosGlyph('cleaning_services');
  static const cleaningServicesOutlined = PosGlyph(
    'cleaning_services_outlined',
  );
  static const clear = PosGlyph('clear');
  static const close = PosGlyph('close');
  static const cloudDoneOutlined = PosGlyph('cloud_done_outlined');
  static const cloudOff = PosGlyph('cloud_off');
  static const cloudOffOutlined = PosGlyph('cloud_off_outlined');
  static const contactlessOutlined = PosGlyph('contactless_outlined');
  static const creditCard = PosGlyph('credit_card');
  static const creditCardOutlined = PosGlyph('credit_card_outlined');
  static const deleteOutline = PosGlyph('delete_outline');
  static const deleteSweepOutlined = PosGlyph('delete_sweep_outlined');
  static const desktopWindowsOutlined = PosGlyph('desktop_windows_outlined');
  static const devicesOtherOutlined = PosGlyph('devices_other_outlined');
  static const dialpadOutlined = PosGlyph('dialpad_outlined');
  static const domainDisabledOutlined = PosGlyph('domain_disabled_outlined');
  static const downloadingOutlined = PosGlyph('downloading_outlined');
  static const editOutlined = PosGlyph('edit_outlined');
  static const emailOutlined = PosGlyph('email_outlined');
  static const errorOutline = PosGlyph('error_outline');
  static const eventSeat = PosGlyph('event_seat');
  static const expandMore = PosGlyph('expand_more');
  static const factCheckOutlined = PosGlyph('fact_check_outlined');
  static const healthAndSafetyOutlined = PosGlyph('health_and_safety_outlined');
  static const helpOutline = PosGlyph('help_outline');
  static const history = PosGlyph('history');
  static const inbox = PosGlyph('inbox');
  static const inboxOutlined = PosGlyph('inbox_outlined');
  static const infoOutline = PosGlyph('info_outline');
  static const inventory2Outlined = PosGlyph('inventory_2_outlined');
  static const inventoryOutlined = PosGlyph('inventory_outlined');
  static const list = PosGlyph('list');
  static const localFireDepartment = PosGlyph('local_fire_department');
  static const lockClockOutlined = PosGlyph('lock_clock_outlined');
  static const lockOpen = PosGlyph('lock_open');
  static const lockOutline = PosGlyph('lock_outline');
  static const login = PosGlyph('login');
  static const logout = PosGlyph('logout');
  static const loyaltyOutlined = PosGlyph('loyalty_outlined');
  static const manageSearch = PosGlyph('manage_search');
  static const mapOutlined = PosGlyph('map_outlined');
  static const mergeType = PosGlyph('merge_type');
  static const moreVert = PosGlyph('more_vert');
  static const pause = PosGlyph('pause');
  static const volumeUp = PosGlyph('volume_up');
  static const volumeOff = PosGlyph('volume_off');
  static const pauseCircleOutline = PosGlyph('pause_circle_outline');
  static const paymentsOutlined = PosGlyph('payments_outlined');
  static const peopleAltOutlined = PosGlyph('people_alt_outlined');
  static const personAddAlt = PosGlyph('person_add_alt');
  static const personAddAlt1Outlined = PosGlyph('person_add_alt_1_outlined');
  static const personAddOutlined = PosGlyph('person_add_outlined');
  static const personOffOutlined = PosGlyph('person_off_outlined');
  static const personOutline = PosGlyph('person_outline');
  static const personRemoveOutlined = PosGlyph('person_remove_outlined');
  static const phoneOutlined = PosGlyph('phone_outlined');
  static const phonelinkEraseOutlined = PosGlyph('phonelink_erase_outlined');
  static const phonelinkLockOutlined = PosGlyph('phonelink_lock_outlined');
  static const playArrow = PosGlyph('play_arrow');
  static const playCircleOutline = PosGlyph('play_circle_outline');
  static const pointOfSale = PosGlyph('point_of_sale');
  static const pointOfSaleOutlined = PosGlyph('point_of_sale_outlined');
  static const policyOutlined = PosGlyph('policy_outlined');
  static const precisionManufacturingOutlined = PosGlyph(
    'precision_manufacturing_outlined',
  );
  static const previewOutlined = PosGlyph('preview_outlined');
  static const printOutlined = PosGlyph('print_outlined');
  static const privacyTipOutlined = PosGlyph('privacy_tip_outlined');
  static const qrCode2 = PosGlyph('qr_code_2');
  static const qrCodeScannerOutlined = PosGlyph('qr_code_scanner_outlined');
  static const radioButtonChecked = PosGlyph('radio_button_checked');
  static const radioButtonUnchecked = PosGlyph('radio_button_unchecked');
  static const receiptLong = PosGlyph('receipt_long');
  static const receiptLongOutlined = PosGlyph('receipt_long_outlined');
  static const receiptOutlined = PosGlyph('receipt_outlined');
  static const redeemOutlined = PosGlyph('redeem_outlined');
  static const refresh = PosGlyph('refresh');
  static const remove = PosGlyph('remove');
  static const removeCircleOutline = PosGlyph('remove_circle_outline');
  static const reportProblemOutlined = PosGlyph('report_problem_outlined');
  static const requestQuote = PosGlyph('request_quote');
  static const restaurant = PosGlyph('restaurant');
  static const restaurantMenu = PosGlyph('restaurant_menu');
  static const restaurantMenuOutlined = PosGlyph('restaurant_menu_outlined');
  static const restaurantOutlined = PosGlyph('restaurant_outlined');
  static const restoreOutlined = PosGlyph('restore_outlined');
  static const routeOutlined = PosGlyph('route_outlined');
  static const savingsOutlined = PosGlyph('savings_outlined');
  static const schedule = PosGlyph('schedule');
  static const search = PosGlyph('search');
  static const searchOff = PosGlyph('search_off');
  static const settingsOutlined = PosGlyph('settings_outlined');
  static const shoppingCartOutlined = PosGlyph('shopping_cart_outlined');
  static const shoppingBagOutlined = PosGlyph('shopping_bag_outlined');
  static const soupKitchenOutlined = PosGlyph('soup_kitchen_outlined');
  static const starOutline = PosGlyph('star_outline');
  static const starsOutlined = PosGlyph('stars_outlined');
  static const storageOutlined = PosGlyph('storage_outlined');
  static const storeOutlined = PosGlyph('store_outlined');
  static const supervisorAccountOutlined = PosGlyph(
    'supervisor_account_outlined',
  );
  static const supportAgentOutlined = PosGlyph('support_agent_outlined');
  static const swapHoriz = PosGlyph('swap_horiz');
  static const sync = PosGlyph('sync');
  static const syncAlt = PosGlyph('sync_alt');
  static const syncProblemOutlined = PosGlyph('sync_problem_outlined');
  static const systemUpdateAltOutlined = PosGlyph('system_update_alt_outlined');
  static const tableRestaurantOutlined = PosGlyph('table_restaurant_outlined');
  static const takeoutDiningOutlined = PosGlyph('takeout_dining_outlined');
  static const trendingDown = PosGlyph('trending_down');
  static const trendingUp = PosGlyph('trending_up');
  static const tune = PosGlyph('tune');
  static const tuneOutlined = PosGlyph('tune_outlined');
  static const undo = PosGlyph('undo');
  static const usb = PosGlyph('usb');
  static const verifiedOutlined = PosGlyph('verified_outlined');
  static const visibilityOffOutlined = PosGlyph('visibility_off_outlined');
  static const visibilityOutlined = PosGlyph('visibility_outlined');
  static const warningAmberOutlined = PosGlyph('warning_amber_outlined');
}

class PosIcon extends StatelessWidget {
  const PosIcon(
    this.icon, {
    this.size,
    this.color,
    this.semanticLabel,
    this.strokeWidth = 1.65,
    super.key,
  });
  final PosGlyph? icon;
  final double? size;
  final Color? color;
  final String? semanticLabel;
  final double strokeWidth;
  @override
  Widget build(BuildContext context) {
    final name = icon?.name;
    final svg = posNavigationSvgs[name] ?? posControlSvgs[name];
    assert(name == null || svg != null, 'Glifo sin dibujo: $name');
    return Semantics(
      label: semanticLabel,
      excludeSemantics: semanticLabel == null,
      child: SizedBox.square(
        dimension: size ?? IconTheme.of(context).size ?? 24,
        child: svg == null
            ? null
            : SvgPicture.string(
                strokeWidth == 1.65
                    ? svg
                    : svg.replaceFirst(
                        'stroke-width="1.65"',
                        'stroke-width="$strokeWidth"',
                      ),
                colorFilter: ColorFilter.mode(
                  color ??
                      IconTheme.of(context).color ??
                      PosTheme.of(context).colorScheme.onSurface,
                  BlendMode.srcIn,
                ),
              ),
      ),
    );
  }
}
