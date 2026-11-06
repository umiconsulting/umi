// Regenerate from the approved prototype's installed lucide-react dependency.
// node tool/generate_lucide_controls.cjs /path/to/node_modules/lucide-react [--check]
const fs = require('node:fs');
const path = require('node:path');
const dependency = process.argv[2];
if (!dependency) throw new Error('Pass the installed lucide-react directory');
const pkg = require(path.join(dependency, 'package.json'));
if (pkg.version !== '0.468.0') throw new Error(`Expected Lucide 0.468.0, got ${pkg.version}`);
const lucide = require(dependency);
const destination = path.join(__dirname, '../lib/core/theme/pos_control_glyphs.dart');
// Explicit semantic mapping. No name-substring inference at generation or runtime.
const icons = {
  assignment_return_outlined: 'ClipboardX',
  account_balance_wallet_outlined: 'Wallet',
  account_circle_outlined: 'CircleUserRound',
  add: 'Plus',
  add_card_outlined: 'CreditCard',
  add_circle_outline: 'CirclePlus',
  add_shopping_cart_outlined: 'Plus',
  arrow_back: 'ArrowLeft',
  arrow_drop_down: 'ChevronDown',
  arrow_forward: 'ArrowRight',
  arrow_upward: 'ArrowUp',
  assignment_turned_in_outlined: 'ClipboardCheck',
  backspace_outlined: 'Delete',
  badge_outlined: 'ContactRound',
  balance_outlined: 'Scale',
  block: 'Ban',
  block_outlined: 'Ban',
  broken_image_outlined: 'ImageOff',
  call_split: 'Split',
  cancel_outlined: 'CircleX',
  card_giftcard: 'Gift',
  card_giftcard_outlined: 'Gift',
  check: 'Check',
  check_box: 'SquareCheck',
  check_box_outline_blank: 'Square',
  check_box_outlined: 'SquareCheck',
  check_circle: 'CircleCheck',
  check_circle_outline: 'CircleCheck',
  chevron_right: 'ChevronRight',
  cleaning_services: 'Brush',
  cleaning_services_outlined: 'Brush',
  clear: 'X',
  close: 'X',
  cloud_done_outlined: 'Wifi',
  cloud_off: 'CloudOff',
  cloud_off_outlined: 'CloudOff',
  contactless_outlined: 'Nfc',
  credit_card: 'CreditCard',
  credit_card_outlined: 'CreditCard',
  delete_outline: 'Trash2',
  delete_sweep_outlined: 'Trash2',
  desktop_windows_outlined: 'Monitor',
  devices_other_outlined: 'TabletSmartphone',
  dialpad_outlined: 'Keyboard',
  domain_disabled_outlined: 'Building2',
  downloading_outlined: 'Download',
  edit_outlined: 'Pencil',
  email_outlined: 'Mail',
  error_outline: 'CircleAlert',
  event_seat: 'Armchair',
  expand_more: 'ChevronDown',
  fact_check_outlined: 'ClipboardCheck',
  health_and_safety_outlined: 'FlaskConical',
  help_outline: 'CircleHelp',
  history: 'History',
  inbox: 'Inbox',
  inbox_outlined: 'Inbox',
  info_outline: 'Info',
  inventory_2_outlined: 'Package',
  inventory_outlined: 'ClipboardList',
  list: 'List',
  local_fire_department: 'Flame',
  lock_clock_outlined: 'LockKeyhole',
  lock_open: 'LockKeyholeOpen',
  lock_outline: 'LockKeyhole',
  login: 'LogIn',
  logout: 'LogOut',
  loyalty_outlined: 'BadgePercent',
  manage_search: 'FileSearch',
  map_outlined: 'Map',
  merge_type: 'Merge',
  more_vert: 'EllipsisVertical',
  pause: 'Pause',
  volume_up: 'Volume2',
  volume_off: 'VolumeX',
  pause_circle_outline: 'CirclePause',
  payments_outlined: 'Banknote',
  people_alt_outlined: 'Users',
  person_add_alt: 'UserRoundPlus',
  person_add_alt_1_outlined: 'UserRoundPlus',
  person_add_outlined: 'UserRoundPlus',
  person_off_outlined: 'UserRoundX',
  person_outline: 'UserRound',
  person_remove_outlined: 'UserRoundMinus',
  phone_outlined: 'Phone',
  phonelink_erase_outlined: 'Smartphone',
  phonelink_lock_outlined: 'LockKeyhole',
  play_arrow: 'Play',
  play_circle_outline: 'CirclePlay',
  point_of_sale: 'Vault',
  point_of_sale_outlined: 'Computer',
  policy_outlined: 'ShieldCheck',
  precision_manufacturing_outlined: 'Factory',
  preview_outlined: 'Eye',
  print_outlined: 'Printer',
  privacy_tip_outlined: 'ShieldAlert',
  qr_code_2: 'QrCode',
  qr_code_scanner_outlined: 'ScanQrCode',
  radio_button_checked: 'CircleDot',
  radio_button_unchecked: 'Circle',
  receipt_long: 'ReceiptText',
  receipt_long_outlined: 'ReceiptText',
  receipt_outlined: 'Receipt',
  redeem_outlined: 'Gift',
  refresh: 'RefreshCw',
  remove: 'Minus',
  remove_circle_outline: 'CircleMinus',
  report_problem_outlined: 'TriangleAlert',
  request_quote: 'ReceiptText',
  restaurant: 'Utensils',
  restaurant_menu: 'UtensilsCrossed',
  restaurant_menu_outlined: 'ChefHat',
  restaurant_outlined: 'Utensils',
  restore_outlined: 'RotateCcw',
  route_outlined: 'Route',
  savings_outlined: 'PiggyBank',
  schedule: 'Clock3',
  search: 'Search',
  search_off: 'SearchX',
  settings_outlined: 'Settings',
  shopping_cart_outlined: 'ShoppingBag',
  shopping_bag_outlined: 'ShoppingBag',
  soup_kitchen_outlined: 'ChefHat',
  star_outline: 'Star',
  stars_outlined: 'Sparkles',
  storage_outlined: 'Database',
  store_outlined: 'Store',
  supervisor_account_outlined: 'UsersRound',
  support_agent_outlined: 'Headset',
  swap_horiz: 'ArrowLeftRight',
  sync: 'RefreshCw',
  sync_alt: 'ArrowRightLeft',
  sync_problem_outlined: 'CloudAlert',
  system_update_alt_outlined: 'Download',
  table_restaurant_outlined: 'Table2',
  takeout_dining_outlined: 'ShoppingBag',
  trending_down: 'TrendingDown',
  trending_up: 'TrendingUp',
  tune: 'SlidersHorizontal',
  tune_outlined: 'SlidersHorizontal',
  undo: 'Undo2',
  usb: 'Usb',
  verified_outlined: 'BadgeCheck',
  visibility_off_outlined: 'EyeOff',
  visibility_outlined: 'Eye',
  warning_amber_outlined: 'TriangleAlert',
  bank: 'Landmark',
  send: 'Send',
  repeat: 'Repeat2',
  cash_drawer: 'Vault',
};
const escapeXml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const generated = new Map();
let nodeCount = 0;
const tags = new Set();
for (const [name, exportName] of Object.entries(icons)) {
  const nodes = lucide[exportName]?.render({}, null).props.iconNode;
  if (!nodes?.length) throw new Error(`Missing Lucide nodes for ${name}: ${exportName}`);
  const normalized = nodes.map(([tag, attrs]) => [
    tag,
    Object.fromEntries(
      Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => [key, String(value)]),
    ),
  ]);
  const inner = normalized
    .map(([tag, attrs]) => {
      if (!['path', 'circle', 'rect', 'polyline', 'line', 'polygon', 'ellipse'].includes(tag))
        throw new Error(`Unsupported SVG tag ${tag}`);
      tags.add(tag);
      nodeCount++;
      return `<${tag} ${Object.entries(attrs)
        .map(([key, value]) => `${key}="${escapeXml(value)}"`)
        .join(' ')}/>`;
    })
    .join('');
  // Roundtrip every node and attribute: prevents the earlier multiline-path loss.
  const parsed = [...inner.matchAll(/<(\w+)\s+([^>]+)\/>/g)].map(([, tag, attrs]) => [
    tag,
    Object.fromEntries(
      [...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
    ),
  ]);
  if (JSON.stringify(parsed) !== JSON.stringify(normalized))
    throw new Error(`Node roundtrip failed: ${name}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  generated.set(name, svg);
}
if (process.argv.includes('--check')) {
  const existing = new Map(
    [...fs.readFileSync(destination, 'utf8').matchAll(/'([^']+)':\s*'([^']+)'/g)].map(
      ([, name, svg]) => [name, svg],
    ),
  );
  if (existing.size !== generated.size) throw new Error('Generated icon count changed');
  for (const [name, svg] of generated)
    if (existing.get(name) !== svg)
      throw new Error(`Asset differs from complete upstream nodes: ${name}`);
} else {
  const license = fs.readFileSync(path.join(dependency, 'LICENSE'), 'utf8');
  const header =
    '// Generated by tool/generate_lucide_controls.cjs; do not edit paths by hand.\n' +
    '// Source: lucide-react 0.468.0, https://github.com/lucide-icons/lucide/tree/0.468.0\n' +
    '// Complete upstream iconNode trees; root stroke matches the native navigation.\n' +
    license
      .split('\n')
      .map((line) => '// ' + line)
      .join('\n') +
    '\n\n';
  const entries = [...generated].map(([name, svg]) => `  '${name}':\n      '${svg}',`).join('\n');
  fs.writeFileSync(
    destination,
    header + 'const posControlSvgs = <String, String>{\n' + entries + '\n};\n',
  );
}
console.log(
  `${generated.size} glyphs; ${nodeCount} complete nodes; tags: ${[...tags].sort().join(', ')}; upstream ${pkg.version}`,
);
