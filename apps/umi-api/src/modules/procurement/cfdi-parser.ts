/**
 * A supplier's CFDI 4.0 file, read as UNTRUSTED INPUT (plan D10 and §10.1).
 *
 * WHY THIS FILE EXISTS. The platform already stamps the CFDIs it issues through a
 * PAC (`modules/fiscal`), and a RECEIVED CFDI is a different object: it arrives from
 * a stranger, it was written by a program nobody here controls, and it decides the
 * price the café's stock is valued at. The fiscal module's knowledge of the format
 * is reused here; its writer is not.
 *
 * NO HAND-WRITTEN XML READER. `fast-xml-parser` is the installed tool (plan §4
 * "tool selection"), and it is configured for the two things that matter with a
 * supplier's file:
 *
 *   · ENTITY EXPANSION IS OFF. `processEntities: false` means no entity of any kind
 *     is resolved, so an external entity (or an internal one that expands to another)
 *     cannot be fetched or expanded. The library refuses a document that DECLARES an
 *     external entity before this comment even matters, and the refusal is reported
 *     as `EXTERNAL_ENTITY` rather than thrown at the caller. The cost is cosmetic and
 *     deliberate: a description that the file wrote as `&amp;` stays as the file
 *     wrote it, because decoding it would mean running an entity resolver over text a
 *     stranger chose.
 *   · NOTHING IS COERCED TO A NUMBER. `parseTagValue` and `parseAttributeValue` are
 *     off, so every value arrives as the string the file carried and the ONE rounding
 *     step below is the only arithmetic the document is subjected to.
 *
 * MONEY IS INTEGER MINOR UNITS. A decimal string becomes an integer of centavos by
 * one half-up rounding step in BigInt. No float is produced, stored or returned, and
 * no amount is ever re-derived from an IEEE754 double.
 *
 * FAILURE IS A VALUE, NOT AN EXCEPTION. Every refusal is a discriminated result the
 * command door turns into `SUPPLIER_INVOICE_PARSE_FAILED` with a code and a sentence,
 * so a console can say WHAT about the file it could not read instead of reporting that
 * something went wrong.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { extendedLineTotalMinor } from './procurement-domain';

/** The unit union the database, the contract and `procurement-domain` all share. */
export type ParsedUnit =
  'unit' | 'gram' | 'kilogram' | 'milliliter' | 'liter' | 'portion' | 'package' | 'box';

/** One concept of the comprobante: what the supplier says they sold. */
export interface ParsedCfdiConcept {
  lineNumber: number;
  description: string;
  quantity: { value: number; scale: number; unit: ParsedUnit };
  unitCostMinor: number;
  lineTotalMinor: number;
  /** `NoIdentificacion`: the supplier's own code for the article, when they wrote one. */
  supplierSku: string | null;
}

export interface ParsedCfdiInvoice {
  issuerRfc: string | null;
  issuerName: string | null;
  folio: string | null;
  uuid: string;
  issuedOn: string | null;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  concepts: ParsedCfdiConcept[];
}

/**
 * The refusal codes. They are published in `details.code` beside the command's own
 * `SUPPLIER_INVOICE_PARSE_FAILED`, because "the file is not XML" and "the file has no
 * timbre" are different messages to the person holding the paper.
 */
export type CfdiFailureCode =
  | 'NOT_XML'
  | 'MALFORMED_XML'
  | 'EXTERNAL_ENTITY'
  | 'NO_COMPROBANTE'
  | 'NO_TIMBRE'
  | 'INVALID_UUID'
  | 'INVALID_SUBTOTAL'
  | 'INVALID_TAX'
  | 'INVALID_TOTAL'
  | 'INVALID_CURRENCY'
  | 'INVALID_ISSUED_DATE'
  | 'NO_CONCEPTS'
  | 'INVALID_CONCEPT';

export type CfdiParseResult =
  { ok: true; invoice: ParsedCfdiInvoice } | { ok: false; code: CfdiFailureCode; detail: string };

const ATTR = '@_';
/** The SAT writes money with two decimals; the shape of `minor units` is two. */
const MONEY_SCALE = 2;
const MAX_QUANTITY_SCALE = 6;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A plain non-negative decimal. Signs, exponents and empty parts are refused. */
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

/**
 * THE ONE PARSER INSTANCE. Constructed once so the options cannot drift between two
 * call sites, and immutable in practice: `fast-xml-parser` copies its options at
 * construction.
 */
const CFDI_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // See the header: no entity is resolved, external or otherwise.
  processEntities: false,
  // Namespaces vary in the wild, so the prefix is kept and matched away locally by
  // `localName` rather than stripped: stripping hides which prefix a document used,
  // which is evidence when a file is refused.
  removeNSPrefix: false,
});

type XmlNode = Record<string, unknown>;

const isNode = (value: unknown): value is XmlNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `cfdi:Concepto`, `tfd:TimbreFiscalDigital` and `Concepto` share a local name. */
function localName(key: string): string {
  const separator = key.lastIndexOf(':');
  return separator === -1 ? key : key.slice(separator + 1);
}

function isAttributeKey(key: string): boolean {
  return key.startsWith(ATTR);
}

/** Every child of `node` whose LOCAL name matches, in document order. */
function children(node: XmlNode, name: string): unknown[] {
  const found: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (isAttributeKey(key) || localName(key) !== name) continue;
    // A repeated tag arrives as an array and a single one as an object; both are
    // flattened here so a one-line invoice and a fifty-line invoice take one path.
    if (Array.isArray(value)) found.push(...value);
    else found.push(value);
  }
  return found;
}

function child(node: XmlNode, name: string): unknown {
  return children(node, name)[0];
}

/** `attribute` reads one attribute off an element. An absent one is null, not "". */
function attribute(node: XmlNode, name: string): string | null {
  const value = node[`${ATTR}${name}`];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * The first descendant with a local name, depth-first. `TimbreFiscalDigital` is
 * reached this way because its parent is `Complemento`, whose own namespace prefix
 * is not fixed either.
 */
function descendant(node: XmlNode, name: string, depth = 0): XmlNode | null {
  if (depth > 12) return null;
  for (const [key, value] of Object.entries(node)) {
    if (isAttributeKey(key) || localName(key) !== name) continue;
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) if (isNode(candidate)) return candidate;
  }
  for (const [key, value] of Object.entries(node)) {
    if (isAttributeKey(key) || localName(key) === name) continue;
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      if (!isNode(candidate)) continue;
      const found = descendant(candidate, name, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * A decimal string as an EXACT scaled integer, rounded HALF UP at `scale` places, or
 * null when the text is not a plain decimal.
 *
 * Half up is the rule the supplier's own document uses, and BigInt is what keeps the
 * rounding from becoming a coin flip: `12.05 × 100` in doubles is 1204.9999..., which
 * would truncate to 1204 and lose a centavo on a line the supplier wrote as 1205.
 */
export function scaledDecimal(text: string, scale: number): bigint | null {
  const trimmed = text.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const digits = BigInt(`${whole}${fraction}`);
  const drop = fraction.length - scale;
  if (drop <= 0) return digits * 10n ** BigInt(-drop);
  const divisor = 10n ** BigInt(drop);
  const quotient = digits / divisor;
  const remainder = digits % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

const toSafeInteger = (value: bigint): number | null =>
  value >= 0n && value <= MAX_SAFE ? Number(value) : null;

/** A money attribute as integer minor units, or null when it is not a decimal. */
function moneyMinor(node: XmlNode, name: string): number | null {
  const raw = attribute(node, name);
  if (raw === null) return null;
  const scaled = scaledDecimal(raw, MONEY_SCALE);
  return scaled === null ? null : toSafeInteger(scaled);
}

/** The SAT's `ClaveUnidad`, plus the words a supplier may write instead. */
const UNIT_BY_CLAVE: Readonly<Record<string, ParsedUnit>> = {
  // UNECE codes the SAT publishes in `c_ClaveUnidad`.
  H87: 'unit',
  EA: 'unit',
  E48: 'unit',
  ACT: 'unit',
  XUN: 'unit',
  GRM: 'gram',
  KGM: 'kilogram',
  MLT: 'milliliter',
  LTR: 'liter',
  XBX: 'box',
  XPK: 'package',
};

const UNIT_BY_WORD: Readonly<Record<string, ParsedUnit>> = {
  pza: 'unit',
  pieza: 'unit',
  piezas: 'unit',
  unidad: 'unit',
  unidades: 'unit',
  unit: 'unit',
  units: 'unit',
  g: 'gram',
  gramo: 'gram',
  gramos: 'gram',
  gram: 'gram',
  grams: 'gram',
  kg: 'kilogram',
  kilo: 'kilogram',
  kilos: 'kilogram',
  kilogramo: 'kilogram',
  kilogramos: 'kilogram',
  kilogram: 'kilogram',
  ml: 'milliliter',
  mililitro: 'milliliter',
  mililitros: 'milliliter',
  milliliter: 'milliliter',
  l: 'liter',
  lt: 'liter',
  litro: 'liter',
  litros: 'liter',
  liter: 'liter',
  caja: 'box',
  cajas: 'box',
  box: 'box',
  paquete: 'package',
  paquetes: 'package',
  package: 'package',
};

/** Lower-case, accent-free, punctuation-free: the form both maps are keyed by. */
function normalizeWord(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * The unit, from the SAT code first and the supplier's own word second, and `unit`
 * when neither is recognised. A guessed unit is still a unit the person confirming
 * the invoice can correct; refusing the file over an unknown abbreviation would be
 * refusing a document that is perfectly readable.
 */
function unitOf(clave: string | null, unidad: string | null): ParsedUnit {
  if (clave !== null) {
    const byClave = UNIT_BY_CLAVE[clave.trim().toUpperCase()];
    if (byClave) return byClave;
  }
  if (unidad !== null) {
    const byWord = UNIT_BY_WORD[normalizeWord(unidad)];
    if (byWord) return byWord;
  }
  return 'unit';
}

const fail = (code: CfdiFailureCode, detail: string): CfdiParseResult => ({
  ok: false,
  code,
  detail,
});

/** A comprobante's folio, bounded by the column it is written to. */
function folioOf(comprobante: XmlNode): string | null {
  const raw = attribute(comprobante, 'Folio');
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, 80);
}

/** The date part of `Fecha`, which the column stores as a calendar day. */
function issuedOnOf(comprobante: XmlNode): { ok: true; value: string | null } | { ok: false } {
  const raw = attribute(comprobante, 'Fecha');
  if (raw === null || raw.trim() === '') return { ok: true, value: null };
  const day = raw.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? { ok: true, value: day } : { ok: false };
}

const currencyOf = (comprobante: XmlNode): string | null => {
  const raw = attribute(comprobante, 'Moneda');
  if (raw === null || raw.trim() === '') return 'MXN';
  const trimmed = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
};

/** Read one concept. Any unreadable part refuses the WHOLE file, named by line. */
function conceptOf(node: XmlNode, lineNumber: number): ParsedCfdiConcept | string {
  const description = (attribute(node, 'Descripcion') ?? '').trim();
  if (description === '') return `concepto ${lineNumber} has no Descripcion`;

  const cantidadRaw = attribute(node, 'Cantidad');
  const cantidad = cantidadRaw === null ? null : cantidadRaw.trim();
  if (cantidad === null || !DECIMAL_PATTERN.test(cantidad)) {
    return `concepto ${lineNumber} has a Cantidad that is not a decimal`;
  }
  const fraction = cantidad.includes('.') ? cantidad.slice(cantidad.indexOf('.') + 1) : '';
  const scale = Math.min(fraction.length, MAX_QUANTITY_SCALE);
  const quantity = scaledDecimal(cantidad, scale);
  const quantityValue = quantity === null ? null : toSafeInteger(quantity);
  if (quantityValue === null || quantityValue < 1) {
    return `concepto ${lineNumber} has a Cantidad of zero or out of range`;
  }

  const unitCostMinor = moneyMinor(node, 'ValorUnitario');
  if (unitCostMinor === null) {
    return `concepto ${lineNumber} has a ValorUnitario that is not a decimal`;
  }

  // The document's own `Importe` wins when it is readable: the supplier's line total
  // is what they actually charged, and their rounding of quantity × price is theirs.
  const statedTotal = moneyMinor(node, 'Importe');
  const lineTotalMinor =
    statedTotal ?? extendedLineTotalMinor({ value: quantityValue, scale, unitCostMinor });

  const skuRaw = (attribute(node, 'NoIdentificacion') ?? '').trim();
  return {
    lineNumber,
    description: description.slice(0, 300),
    quantity: {
      value: quantityValue,
      scale,
      unit: unitOf(attribute(node, 'ClaveUnidad'), attribute(node, 'Unidad')),
    },
    unitCostMinor,
    lineTotalMinor,
    supplierSku: skuRaw === '' ? null : skuRaw.slice(0, 80),
  };
}

/**
 * Read one CFDI 4.0 file. The return value is the whole answer: callers never catch
 * an exception to find out why a supplier's document could not be read.
 */
export function parseCfdiInvoice(xml: string): CfdiParseResult {
  if (typeof xml !== 'string' || xml.trim() === '') {
    return fail('NOT_XML', 'The upload carried no text.');
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    return fail('NOT_XML', `The file is not XML: ${validation.err.msg}`);
  }

  let document: unknown;
  try {
    document = CFDI_PARSER.parse(xml) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The library refuses a DOCTYPE that declares an external entity, which is the
    // one construct that could make a stranger's file reach outside the process.
    return message.includes('External entities')
      ? fail('EXTERNAL_ENTITY', 'The file declares an external entity, which is never resolved.')
      : fail('MALFORMED_XML', message);
  }
  if (!isNode(document)) return fail('NO_COMPROBANTE', 'The file has no root element.');

  const comprobante = child(document, 'Comprobante');
  if (!isNode(comprobante)) {
    return fail('NO_COMPROBANTE', 'The file has no Comprobante element.');
  }

  const timbre = descendant(comprobante, 'TimbreFiscalDigital');
  if (!timbre) return fail('NO_TIMBRE', 'The file has no TimbreFiscalDigital element.');
  const uuid = (attribute(timbre, 'UUID') ?? '').trim();
  if (!UUID_PATTERN.test(uuid)) {
    return fail('INVALID_UUID', 'The timbre carries no UUID that the platform can store.');
  }

  const subtotalRaw = attribute(comprobante, 'SubTotal');
  const subtotal = subtotalRaw === null ? null : scaledDecimal(subtotalRaw, MONEY_SCALE);
  const subtotalMinor = subtotal === null ? null : toSafeInteger(subtotal);
  if (subtotalMinor === null) {
    return fail('INVALID_SUBTOTAL', 'The SubTotal is not a decimal amount.');
  }

  const totalRaw = attribute(comprobante, 'Total');
  const total = totalRaw === null ? null : scaledDecimal(totalRaw, MONEY_SCALE);
  const totalMinor = total === null ? null : toSafeInteger(total);
  if (totalMinor === null) {
    return fail('INVALID_TOTAL', 'The Total is not a decimal amount.');
  }

  // A transferred-tax total may be absent (a rate-zero document), so absent is zero.
  // Present-but-unreadable is refused, because turning it into zero would silently
  // understate what the café paid.
  const impuestos = child(comprobante, 'Impuestos');
  const taxRaw = isNode(impuestos) ? attribute(impuestos, 'TotalImpuestosTrasladados') : null;
  const tax = taxRaw === null ? 0n : scaledDecimal(taxRaw, MONEY_SCALE);
  const taxMinor = tax === null ? null : toSafeInteger(tax);
  if (taxMinor === null) {
    return fail('INVALID_TAX', 'The transferred-tax total is not a decimal amount.');
  }

  const currency = currencyOf(comprobante);
  if (currency === null) {
    return fail('INVALID_CURRENCY', 'The Moneda is not a three-letter currency code.');
  }

  const issuedOn = issuedOnOf(comprobante);
  if (!issuedOn.ok) {
    return fail('INVALID_ISSUED_DATE', 'The Fecha is not a calendar date.');
  }

  const conceptos = child(comprobante, 'Conceptos');
  if (!isNode(conceptos)) return fail('NO_CONCEPTS', 'The file has no Conceptos element.');
  const conceptNodes = children(conceptos, 'Concepto');
  if (conceptNodes.length === 0) {
    return fail('NO_CONCEPTS', 'The file has no Concepto element.');
  }

  const concepts: ParsedCfdiConcept[] = [];
  for (const [index, node] of conceptNodes.entries()) {
    if (!isNode(node)) return fail('INVALID_CONCEPT', `concepto ${index + 1} is not an element`);
    const parsed = conceptOf(node, index + 1);
    if (typeof parsed === 'string') return fail('INVALID_CONCEPT', parsed);
    concepts.push(parsed);
  }

  const emisorNode = child(comprobante, 'Emisor');
  const emisor = isNode(emisorNode) ? emisorNode : null;

  return {
    ok: true,
    invoice: {
      issuerRfc: emisor === null ? null : attribute(emisor, 'Rfc'),
      issuerName: emisor === null ? null : attribute(emisor, 'Nombre'),
      folio: folioOf(comprobante),
      uuid: uuid.toLowerCase(),
      issuedOn: issuedOn.value,
      currency,
      subtotalMinor,
      taxMinor,
      totalMinor,
      concepts,
    },
  };
}
