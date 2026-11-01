import Papa from 'papaparse';
import {
  EXAMPLES,
  IMPORT_LIMITS,
  ITEM_TYPES,
  UNITS,
  columnsFor,
  fileError,
  requiredColumnsFor,
} from './schema.js';

// These worksheet names form the file contract and remain stable in each locale.
/* eslint-disable lingui/no-unlocalized-strings -- Stable file contract names and keys. */
const SHEETS = {
  items: 'Articulos',
  recipes: 'Recetas',
  guide: 'Guia',
  examples: 'Ejemplos',
  references: 'Referencias',
  results: 'Resultados',
};
/* eslint-enable lingui/no-unlocalized-strings */

async function excel() {
  // The browser bundle also works inside a worker and has no Node built-ins.
  const module = await import('exceljs/dist/exceljs.min.js');
  return module.default;
}

function validateFormat(format) {
  if (format !== 'csv' && format !== 'xlsx') throw fileError('UNSUPPORTED_FORMAT');
}

function normalizedDecimal(text) {
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimal = fraction.replace(/0+$/, '');
  const unsigned = `${integer}${decimal ? `.${decimal}` : ''}`;
  return negative && unsigned !== '0' ? `-${unsigned}` : unsigned;
}

function cellText(value, originalNumber) {
  if (value == null) return { text: '' };
  if (typeof value === 'string') return { text: value };
  if (typeof value === 'number') {
    const text = String(value);
    if (
      !Number.isFinite(value) ||
      Math.abs(value) > Number.MAX_SAFE_INTEGER ||
      /e/i.test(text) ||
      typeof originalNumber !== 'string' ||
      !/^-?\d+(?:\.\d+)?$/.test(originalNumber) ||
      normalizedDecimal(originalNumber) !== normalizedDecimal(text)
    ) {
      return { text: '', code: 'UNSAFE_NUMBER' };
    }
    return { text: originalNumber };
  }
  if (value instanceof Date) return { text: '', code: 'DATE_CELL' };
  if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    return { text: '', code: 'FORMULA_CELL' };
  }
  return { text: '', code: 'UNSUPPORTED_CELL' };
}

function mapRows(kind, source) {
  const first = source.findIndex(({ cells }) =>
    cells.some(({ text, code }) => text.trim() !== '' || code),
  );
  if (first < 0) throw fileError('MISSING_HEADER');
  const headerCells = source[first].cells;
  if (headerCells.some(({ code }) => code)) throw fileError('INVALID_HEADER');
  const headers = headerCells.map(({ text }) => text.trim());
  if (new Set(headers).size !== headers.length) throw fileError('DUPLICATE_HEADER');
  if (headers.some((header) => !columnsFor(kind).includes(header)))
    throw fileError('UNKNOWN_HEADER');
  if (requiredColumnsFor(kind).some((column) => !headers.includes(column)))
    throw fileError('MISSING_HEADER');
  const rows = [];
  for (const { rowNumber, cells } of source.slice(first + 1)) {
    if (cells.every(({ text, code }) => text.trim() === '' && !code)) continue;
    if (rows.length === IMPORT_LIMITS.maxRows) throw fileError('TOO_MANY_ROWS');
    const errors = [];
    if (cells.length > headers.length) errors.push({ code: 'COLUMN_COUNT', column: null });
    if (headers.every((header, index) => header === cells[index]?.text.trim())) {
      errors.push({ code: 'REPEATED_HEADER', column: null });
    }
    const values = Object.fromEntries(
      headers.map((column, index) => {
        const cell = cells[index] || { text: '' };
        if (cell.code) errors.push({ code: cell.code, column });
        return [column, cell.text];
      }),
    );
    rows.push({ rowNumber, values, errors });
  }
  return { headers, rows };
}

function parseCsv(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw fileError('INVALID_ENCODING');
  }
  const source = [];
  let previousCursor = 0;
  let rowNumber = 1;
  Papa.parse(text, {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
    delimitersToGuess: [',', ';'],
    step(result) {
      if (result.errors.some(({ code }) => code !== 'UndetectableDelimiter'))
        throw fileError('INVALID_CSV');
      if (result.data.some((text) => text.trim() !== '')) {
        source.push({ rowNumber, cells: result.data.map((text) => ({ text })) });
      }
      rowNumber += (text.slice(previousCursor, result.meta.cursor).match(/\r\n|\r|\n/g) || [])
        .length;
      previousCursor = result.meta.cursor;
      if (source.length > IMPORT_LIMITS.maxRows + 1) {
        throw fileError('TOO_MANY_ROWS');
      }
    },
  });
  return source;
}

async function parseXlsx(kind, bytes) {
  const ExcelJS = await excel();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    throw fileError('INVALID_XLSX');
  }
  const worksheet = workbook.getWorksheet(SHEETS[kind]);
  if (!worksheet) throw fileError('MISSING_DATA_SHEET');
  // Retain numeric XML text before ExcelJS converts it to a JavaScript number.
  const { readSheet } = await import('read-excel-file/universal');
  let originalRows;
  try {
    originalRows = await readSheet(bytes, SHEETS[kind], {
      parseNumber: (text) => text,
      trim: false,
    });
  } catch {
    throw fileError('INVALID_XLSX');
  }
  const source = [];
  worksheet.eachRow((row, rowNumber) => {
    const cells = Array.from({ length: row.cellCount }, (_, index) =>
      cellText(row.getCell(index + 1).value, originalRows[rowNumber - 1]?.[index]),
    );
    if (cells.every(({ text, code }) => text.trim() === '' && !code)) return;
    source.push({ rowNumber, cells });
    if (source.length > IMPORT_LIMITS.maxRows + 1) throw fileError('TOO_MANY_ROWS');
  });
  return source;
}

export async function parseImportFile({ kind, format, bytes }) {
  columnsFor(kind);
  validateFormat(format);
  if (!(bytes instanceof ArrayBuffer)) throw fileError('INVALID_BYTES');
  if (bytes.byteLength > IMPORT_LIMITS.maxBytes) throw fileError('FILE_TOO_LARGE');
  return mapRows(kind, format === 'csv' ? parseCsv(bytes) : await parseXlsx(kind, bytes));
}

function guideRows(kind, labels) {
  const headings = ['field', 'required', 'description', 'example'].map(
    (key) => labels.headings?.[key] || key,
  );
  const rows = columnsFor(kind).map((column) => {
    let description = labels.columns?.[column] || column;
    if (column === 'tipo') description += ` ${ITEM_TYPES.join(', ')}`;
    if (column === 'unidad' || column === 'unidad_rendimiento')
      description += ` ${UNITS.join(', ')}`;
    const required = requiredColumnsFor(kind).includes(column);
    return [
      column,
      required ? labels.required || 'required' : labels.optional || 'optional',
      description,
      EXAMPLES[kind][column],
    ];
  });
  return [headings, ...rows, ['', '', labels.instructions || '', '']];
}

function referenceSheets(references) {
  const items = (references.items || []).map((item) => [
    item.publicReference ?? item.code,
    item.displayName ?? item.name,
    item.baseUnit,
    item.quantityScale,
  ]);
  const targets = (references.targets || []).map((target) => [
    target.productId,
    target.productName,
    target.variantId || '',
    target.variantName || '',
  ]);
  return [
    {
      name: 'Ingredientes',
      rows: [['ingrediente_codigo', 'nombre', 'unidad', 'decimales'], ...items],
    },
    {
      name: 'Productos',
      rows: [['producto_id', 'producto_nombre', 'variante_id', 'variante_nombre'], ...targets],
    },
  ];
}

function downloadSheets({ kind, format, purpose, references = {}, results = [], labels = {} }) {
  const columns = columnsFor(kind);
  if (purpose === 'template') {
    const data = { name: SHEETS[kind], rows: [columns] };
    return format === 'xlsx'
      ? [
          data,
          ...downloadSheets({ kind, format, purpose: 'guide', labels }),
          ...downloadSheets({ kind, format, purpose: 'examples' }),
          ...referenceSheets(references),
        ]
      : [data];
  }
  if (purpose === 'guide') return [{ name: SHEETS.guide, rows: guideRows(kind, labels) }];
  if (purpose === 'examples')
    return [
      { name: SHEETS.examples, rows: [columns, columns.map((column) => EXAMPLES[kind][column])] },
    ];
  if (purpose === 'results')
    return [
      {
        name: SHEETS.results,
        rows: [
          ['fila', 'referencia', 'estado', 'mensaje'],
          ...results.map((row) => [row.rowNumber, row.reference, row.status, row.message]),
        ],
      },
    ];
  if (purpose === 'references') {
    const sheets = referenceSheets(references);
    if (format === 'xlsx') return sheets;
    return [
      {
        name: SHEETS.references,
        rows: [
          [
            'tipo',
            'ingrediente_codigo',
            'nombre',
            'unidad',
            'decimales',
            'producto_id',
            'producto_nombre',
            'variante_id',
            'variante_nombre',
          ],
          ...sheets[0].rows.slice(1).map((row) => ['ingredient', ...row, '', '', '', '']),
          ...sheets[1].rows.slice(1).map((row) => ['target', '', '', '', '', ...row]),
        ],
      },
    ];
  }
  throw fileError('UNSUPPORTED_PURPOSE');
}

export async function buildImportFile(options) {
  const { kind, format, purpose } = options;
  validateFormat(format);
  const sheets = downloadSheets(options).map((sheet) => ({
    ...sheet,
    rows: sheet.rows.map((row) => row.map((value) => String(value ?? ''))),
  }));
  let bytes;
  if (format === 'csv') {
    bytes = new TextEncoder().encode(
      Papa.unparse(sheets[0].rows, { escapeFormulae: true, newline: '\r\n' }),
    ).buffer;
  } else {
    const ExcelJS = await excel();
    const workbook = new ExcelJS.Workbook();
    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);
      worksheet.addRows(sheet.rows);
      worksheet.eachRow((row) =>
        row.eachCell((cell) => {
          cell.numFmt = '@';
        }),
      );
    }
    const buffer = await workbook.xlsx.writeBuffer();
    bytes =
      buffer instanceof ArrayBuffer
        ? buffer
        : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  return {
    bytes,
    mimeType:
      format === 'csv'
        ? 'text/csv;charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `${kind}-${purpose}.${format}`,
  };
}
