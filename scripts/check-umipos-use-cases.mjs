import { readFile } from 'node:fs/promises';

const path = 'docs/product/UMIPOS_CASOS_DE_USO_Y_ROLES.md';
const document = await readFile(path, 'utf8');
const pilotMatrix = JSON.parse(await readFile('config/umipos-pilot-role-grants.json', 'utf8'));

const requiredSections = [
  'Propósito del documento',
  'Visión general del ecosistema',
  'Glosario operativo',
  'Roles y alcance',
  'Ciclo de vida del dispositivo',
  'Acceso del operador',
  'Catálogo',
  'Carrito',
  'Ciclo de vida de la venta',
  'Checkout y pagos',
  'Operación de caja y turnos',
  'Refunds, voids y excepciones postventa',
  'Offline, replay y recuperación',
  'Historial y recibos',
  'Casos de error y recuperación',
  'Jornadas operativas completas por rol',
  'Matriz de casos de uso por rol',
  'Funcionalidades no implementadas todavía',
  'Checklist manual para probar UmiPOS',
  'Mapa de cobertura',
];

for (const [index, title] of requiredSections.entries()) {
  if (!document.includes(`## ${index + 1}. ${title}`)) {
    throw new Error(`Missing required section ${index + 1}: ${title}.`);
  }
}

if (/\/home\/|\b(?:access|refresh)[_-]?token\b\s*[:=]/iu.test(document)) {
  throw new Error('The use-case document contains a local path or a token-shaped value.');
}

const casePattern = /^### (UC-[A-Z]+-\d{3}) — .+$/gmu;
const matches = [...document.matchAll(casePattern)];
const caseIds = matches.map((match) => match[1]);
if (new Set(caseIds).size !== caseIds.length) {
  throw new Error('The use-case document contains a duplicate case identifier.');
}

const requiredFields = [
  '**Estado:**',
  '**Objetivo:**',
  '**Actor principal:**',
  '**Actores secundarios:**',
  '**Permisos requeridos:**',
  '**Precondiciones:**',
  '**Disparador:**',
  '**Flujo principal:**',
  '**Resultado esperado:**',
  '**Flujos alternos:**',
  '**Errores y recuperación:**',
  '**Reglas de seguridad:**',
  '**Persistencia y efectos:**',
  '**Disponibilidad:**',
  '**Evidencia de implementación:**',
];
const statusCounts = new Map();
const moduleCounts = new Map();
let onlineOnlyCount = 0;
let offlineCapableCount = 0;
let nativeOnlyCount = 0;

for (const [index, match] of matches.entries()) {
  const end = matches[index + 1]?.index ?? document.indexOf('\n## 15. Casos de error', match.index);
  const block = document.slice(match.index, end < 0 ? undefined : end);
  for (const field of requiredFields) {
    if (!block.includes(field)) {
      throw new Error(`${match[1]} is missing ${field}.`);
    }
  }
  const status = block.match(/\*\*Estado:\*\* (.+)/u)?.[1]?.trim();
  if (!status) throw new Error(`${match[1]} has no implementation status.`);
  statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  const module = match[1].split('-')[1];
  moduleCounts.set(module, (moduleCounts.get(module) ?? 0) + 1);
  const availability = block.match(/\*\*Disponibilidad:\*\* (.+)/u)?.[1] ?? '';
  if (availability.includes('Online-only')) onlineOnlyCount += 1;
  if (/offline/iu.test(availability)) offlineCapableCount += 1;
  if (availability.includes('Native-only')) nativeOnlyCount += 1;
}

const expectedStatuses = new Map([
  ['IMPLEMENTADO', 37],
  ['IMPLEMENTADO CON LIMITACIONES', 15],
  ['FOUNDATION', 1],
  ['NO IMPLEMENTADO', 0],
]);
if (matches.length !== 53 || !document.includes('**53 casos de uso**')) {
  throw new Error(`Expected 53 use cases, found ${matches.length}.`);
}
for (const [status, expected] of expectedStatuses) {
  const actual = statusCounts.get(status) ?? 0;
  const escapedStatus = status.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const coverageRow = new RegExp(`\\|\\s*${escapedStatus}\\s*\\|\\s*${expected}\\s*\\|`, 'u');
  if (actual !== expected || !coverageRow.test(document)) {
    throw new Error(`Coverage mismatch for ${status}: expected ${expected}, found ${actual}.`);
  }
}

const expectedModules = new Map([
  ['DEV', 4],
  ['AUTH', 4],
  ['CAT', 4],
  ['CART', 4],
  ['SALE', 5],
  ['PAY', 7],
  ['CASH', 7],
  ['REF', 6],
  ['OFF', 4],
  ['HIST', 2],
  ['INV', 6],
]);
for (const [module, expected] of expectedModules) {
  const actual = moduleCounts.get(module) ?? 0;
  if (actual !== expected) {
    throw new Error(`Coverage mismatch for ${module}: expected ${expected}, found ${actual}.`);
  }
}

const matrixRows = document
  .split('\n')
  .filter((line) => line.startsWith('| UC-'))
  .map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
if (matrixRows.length !== matches.length) {
  throw new Error(`Expected ${matches.length} matrix rows, found ${matrixRows.length}.`);
}

const statusByCase = new Map();
for (const [index, match] of matches.entries()) {
  const end = matches[index + 1]?.index ?? document.length;
  const block = document.slice(match.index, end);
  statusByCase.set(match[1], block.match(/\*\*Estado:\*\* (.+)/u)?.[1]?.trim());
}
for (const row of matrixRows) {
  if (row.length !== 15)
    throw new Error(`${row[0]} has ${row.length} matrix columns; expected 15.`);
  if (row[14] !== statusByCase.get(row[0])) {
    throw new Error(`${row[0]} has a matrix status that differs from its case status.`);
  }
}

const roleColumns = new Map([
  ['Owner', 3],
  ['Admin', 4],
  ['Manager', 5],
  ['Supervisor', 6],
  ['Cashier', 7],
  ['Staff', 8],
  ['Viewer', 9],
]);
const expectedRoleCounts = new Map([
  ['Owner', 53],
  ['Admin', 53],
  ['Manager', 49],
  ['Supervisor', 48],
  ['Cashier', 42],
  ['Staff', 42],
  ['Viewer', 8],
]);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const requireCountRow = (label, expected) => {
  const row = new RegExp(`\\|\\s*${escapeRegex(label)}\\s*\\|\\s*${expected}\\s*\\|`, 'u');
  if (!row.test(document)) throw new Error(`The displayed count for ${label} is not ${expected}.`);
};

for (const [role, column] of roleColumns) {
  const actual = matrixRows.filter((row) => !['❌', 'N/A'].includes(row[column])).length;
  const expected = expectedRoleCounts.get(role);
  if (actual !== expected) {
    throw new Error(`Role coverage mismatch for ${role}: expected ${expected}, found ${actual}.`);
  }
  requireCountRow(role, actual);
}

const requiredPermissionByCase = new Map([
  ['UC-DEV-001', 'device.enroll'],
  ['UC-CAT-001', 'catalog.read'],
  ['UC-CART-001', 'cart.write'],
  ['UC-SALE-001', 'sale.lifecycle'],
  ['UC-PAY-001', 'checkout.commit'],
  ['UC-CASH-001', 'cash.shift.open'],
  ['UC-CASH-002', 'cash.movement.paid_in'],
  ['UC-CASH-004', 'cash.drawer.no_sale'],
  ['UC-CASH-005', 'cash.shift.handoff'],
  ['UC-REF-001', 'sale.exception.read'],
  ['UC-REF-002', 'sale.void.create'],
  ['UC-REF-003', 'sale.refund.full'],
  ['UC-REF-004', 'sale.refund.partial'],
  ['UC-OFF-001', 'offline.cash.checkout'],
  ['UC-HIST-002', 'sale.exception.history'],
  ['UC-INV-001', 'inventory.read'],
  ['UC-INV-002', 'checkout.commit'],
  ['UC-INV-004', 'inventory.restock.resolve'],
  ['UC-INV-005', 'inventory.count.create'],
  ['UC-INV-006', 'offline.cash.checkout'],
]);
for (const [caseId, permission] of requiredPermissionByCase) {
  const row = matrixRows.find((value) => value[0] === caseId);
  if (!row) throw new Error(`Missing role matrix row for ${caseId}.`);
  for (const [role, column] of roleColumns) {
    const profile = pilotMatrix.profiles.find((value) => value.role === role.toLowerCase());
    if (!profile) throw new Error(`Missing pilot profile for ${role}.`);
    const documented = !['❌', 'N/A'].includes(row[column]);
    const granted = profile.permissions.includes(permission);
    if (documented !== granted) {
      throw new Error(`${caseId} differs from the canonical ${role} grant for ${permission}.`);
    }
  }
}

const approvalCount = matrixRows.filter((row) => row[13] !== 'No').length;
for (const [label, actual] of [
  ['Online-only', onlineOnlyCount],
  ['Offline-capable', offlineCapableCount],
  ['Requieren o pueden requerir aprobación', approvalCount],
  ['Native-only estricto', nativeOnlyCount],
]) {
  requireCountRow(label, actual);
}

const mermaidBlocks = [...document.matchAll(/```mermaid\n([\s\S]*?)```/gu)].map((match) =>
  match[1].trim(),
);
if (mermaidBlocks.length !== 4) {
  throw new Error(`Expected four Mermaid diagrams, found ${mermaidBlocks.length}.`);
}
for (const diagram of mermaidBlocks) {
  if (!/^(?:flowchart|stateDiagram-v2)\b/u.test(diagram)) {
    throw new Error('A Mermaid diagram has an unsupported or missing declaration.');
  }
  for (const [open, close] of [
    ['[', ']'],
    ['(', ')'],
  ]) {
    const opens = [...diagram].filter((character) => character === open).length;
    const closes = [...diagram].filter((character) => character === close).length;
    if (opens !== closes) throw new Error(`A Mermaid diagram has unbalanced ${open}${close}.`);
  }
}

console.log(
  `UmiPOS use-case checks passed: ${matches.length} cases, ${requiredSections.length} sections, ${mermaidBlocks.length} Mermaid diagrams.`,
);
