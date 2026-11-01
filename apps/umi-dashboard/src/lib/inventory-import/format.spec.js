import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { buildImportPreview } from './preview.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve('exceljs'))('jszip');

const itemHeader = 'codigo,nombre,tipo,unidad,decimales';
const recipeHeader =
  'producto_id,rendimiento,unidad_rendimiento,ingrediente_codigo,cantidad,unidad';
const encoded = (text) => new TextEncoder().encode(text).buffer;
const parse = async (text, kind = 'items') => {
  const { parseImportFile } = await import('./format.js');
  return parseImportFile({ kind, format: 'csv', bytes: encoded(text) });
};
const workbookBytes = async (rows, sheetName = 'Articulos') => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet(sheetName).addRows(rows);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};
const parseWorkbook = async (rows, options = {}) => {
  const { parseImportFile } = await import('./format.js');
  return parseImportFile({
    kind: 'items',
    format: 'xlsx',
    bytes: await workbookBytes(rows, options.sheetName),
  });
};

describe('inventory CSV import', () => {
  it('preserves codes, quoted multiline names and physical source lines after blank rows', async () => {
    const file = await parse(
      `\uFEFF${itemHeader}\r\n001,"Leche,\r\nentera",ingredient,liter,3\r\n\r\n002,Agua,ingredient,liter,3\r\n`,
    );
    expect(file.headers).toEqual(['codigo', 'nombre', 'tipo', 'unidad', 'decimales']);
    expect(file.rows).toEqual([
      {
        rowNumber: 2,
        values: {
          codigo: '001',
          nombre: 'Leche,\r\nentera',
          tipo: 'ingredient',
          unidad: 'liter',
          decimales: '3',
        },
        errors: [],
      },
      {
        rowNumber: 5,
        values: {
          codigo: '002',
          nombre: 'Agua',
          tipo: 'ingredient',
          unidad: 'liter',
          decimales: '3',
        },
        errors: [],
      },
    ]);
  });

  it('accepts semicolons and an omitted variant column', async () => {
    const file = await parse(
      `${recipeHeader.replaceAll(',', ';')}\nproduct;1;unit;MILK;0.25;liter`,
      'recipes',
    );
    expect(file.rows[0].values).toMatchObject({ producto_id: 'product', cantidad: '0.25' });
  });

  it.each([
    [`${itemHeader},codigo\n`, 'DUPLICATE_HEADER'],
    [`${itemHeader},inventado\n`, 'UNKNOWN_HEADER'],
    ['codigo,nombre,tipo,unidad\n', 'MISSING_HEADER'],
    ['', 'MISSING_HEADER'],
    [`${itemHeader}\n001,"open`, 'INVALID_CSV'],
  ])('rejects invalid headers or CSV with %s', async (text, code) => {
    await expect(parse(text)).rejects.toMatchObject({ code });
  });

  it('retains repeated headers and extra columns as row errors', async () => {
    const file = await parse(`${itemHeader}\n${itemHeader}\n001,Leche,ingredient,liter,3,extra`);
    expect(file.rows[0]).toMatchObject({
      rowNumber: 2,
      errors: [{ code: 'REPEATED_HEADER', column: null }],
    });
    expect(file.rows[1].errors).toEqual([{ code: 'COLUMN_COUNT', column: null }]);
  });

  it('rejects files above the byte limit', async () => {
    const { parseImportFile } = await import('./format.js');
    await expect(
      parseImportFile({ kind: 'items', format: 'csv', bytes: new ArrayBuffer(2097153) }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('accepts 500 data rows and rejects 501', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => `${i},Item,ingredient,unit,0`);
    expect((await parse([itemHeader, ...rows].join('\n'))).rows).toHaveLength(500);
    await expect(
      parse([itemHeader, ...rows, '501,Item,ingredient,unit,0'].join('\n')),
    ).rejects.toMatchObject({ code: 'TOO_MANY_ROWS' });
  });

  it('rejects invalid UTF-8 and unsupported file types', async () => {
    const { parseImportFile } = await import('./format.js');
    await expect(
      parseImportFile({ kind: 'items', format: 'csv', bytes: new Uint8Array([255]).buffer }),
    ).rejects.toMatchObject({ code: 'INVALID_ENCODING' });
    await expect(
      parseImportFile({ kind: 'items', format: 'xls', bytes: encoded('') }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
  });
});

describe('inventory Excel import', () => {
  it.each(['0.10000000000000001', '1.0000000000000001', '88259496234518.57'])(
    'rejects original numeric XML that would lose decimal precision: %s',
    async (numericText) => {
      const { parseImportFile } = await import('./format.js');
      const original = await workbookBytes([
        [...itemHeader.split(','), 'costo_unitario'],
        [],
        ['001', 'Milk', 'ingredient', 'liter', '3', 0.1],
      ]);
      const zip = await JSZip.loadAsync(original);
      const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
      zip.file('xl/worksheets/sheet1.xml', sheet.replace('<v>0.1</v>', `<v>${numericText}</v>`));
      const bytes = await zip.generateAsync({ type: 'arraybuffer' });
      const file = await parseImportFile({ kind: 'items', format: 'xlsx', bytes });
      expect(file.rows[0]).toEqual({
        rowNumber: 3,
        values: {
          codigo: '001',
          nombre: 'Milk',
          tipo: 'ingredient',
          unidad: 'liter',
          decimales: '3',
          costo_unitario: '',
        },
        errors: [{ code: 'UNSAFE_NUMBER', column: 'costo_unitario' }],
      });
    },
  );

  it('retains the exact original text of safe numeric cells and their column positions', async () => {
    const { parseImportFile } = await import('./format.js');
    const original = await workbookBytes([
      [...itemHeader.split(','), 'costo_unitario'],
      [],
      ['001', 'Milk', 'ingredient', 'liter', '3', 0.1],
    ]);
    const zip = await JSZip.loadAsync(original);
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    zip.file('xl/worksheets/sheet1.xml', sheet.replace('<v>0.1</v>', '<v>0.1000</v>'));
    const file = await parseImportFile({
      kind: 'items',
      format: 'xlsx',
      bytes: await zip.generateAsync({ type: 'arraybuffer' }),
    });
    expect(file.rows[0]).toMatchObject({
      rowNumber: 3,
      values: { codigo: '001', costo_unitario: '0.1000' },
      errors: [],
    });
  });

  it('preserves text codes, safe numeric strings and sheet row numbers', async () => {
    const file = await parseWorkbook([
      itemHeader.split(','),
      ['001', 'Leche', 'ingredient', 'liter', 3],
      [],
      ['002', 'Agua', 'ingredient', 'liter', 0.25],
    ]);
    expect(file.rows[0]).toMatchObject({
      rowNumber: 2,
      values: { codigo: '001', decimales: '3' },
      errors: [],
    });
    expect(file.rows[1]).toMatchObject({ rowNumber: 4, values: { decimales: '0.25' } });
  });

  it.each([
    [{ formula: '1+1', result: 2 }, 'FORMULA_CELL'],
    [new Date('2026-01-01T00:00:00Z'), 'DATE_CELL'],
    [true, 'UNSUPPORTED_CELL'],
    [{ text: 'link', hyperlink: 'https://example.com' }, 'UNSUPPORTED_CELL'],
    [9007199254740992, 'UNSAFE_NUMBER'],
    [1e-7, 'UNSAFE_NUMBER'],
  ])('rejects unsafe cells and retains other values: %s', async (value, code) => {
    const file = await parseWorkbook([
      itemHeader.split(','),
      ['001', 'Leche', 'ingredient', 'liter', value],
    ]);
    expect(file.rows[0]).toMatchObject({
      values: { codigo: '001', nombre: 'Leche', decimales: '' },
      errors: [{ code, column: 'decimales' }],
    });
  });

  it('retains recipe identity when a component contains a formula', async () => {
    const { parseImportFile } = await import('./format.js');
    const file = await parseImportFile({
      kind: 'recipes',
      format: 'xlsx',
      bytes: await workbookBytes(
        [
          recipeHeader.split(','),
          ['product', '1', 'unit', 'MILK', { formula: '1/4', result: 0.25 }, 'liter'],
        ],
        'Recetas',
      ),
    });
    expect(file.rows[0]).toMatchObject({
      values: { producto_id: 'product', ingrediente_codigo: 'MILK' },
      errors: [{ code: 'FORMULA_CELL', column: 'cantidad' }],
    });
  });

  it('never selects a guide or reference sheet as import data', async () => {
    await expect(
      parseWorkbook([itemHeader.split(',')], { sheetName: 'Guia' }),
    ).rejects.toMatchObject({ code: 'MISSING_DATA_SHEET' });
  });

  it('rejects invalid workbook content with a stable code', async () => {
    const { parseImportFile } = await import('./format.js');
    await expect(
      parseImportFile({ kind: 'items', format: 'xlsx', bytes: encoded('bad') }),
    ).rejects.toMatchObject({ code: 'INVALID_XLSX' });
  });

  it('ignores blank Excel rows when it applies the data row limit', async () => {
    const blankRows = Array.from({ length: 501 }, () => [' ']);
    const file = await parseWorkbook([
      itemHeader.split(','),
      ...blankRows,
      ['001', 'Milk', 'ingredient', 'liter', '3'],
    ]);
    expect(file.rows).toHaveLength(1);
    expect(file.rows[0].rowNumber).toBe(503);
  });

  it('rejects 501 Excel data rows', async () => {
    await expect(
      parseWorkbook([
        itemHeader.split(','),
        ...Array.from({ length: 501 }, () => ['001', 'Milk', 'ingredient', 'liter', '3']),
      ]),
    ).rejects.toMatchObject({ code: 'TOO_MANY_ROWS' });
  });
});

describe('inventory downloads', () => {
  it.each(['items', 'recipes'])(
    'creates header-only templates for %s in both formats',
    async (kind) => {
      const { buildImportFile, parseImportFile } = await import('./format.js');
      for (const format of ['csv', 'xlsx']) {
        const output = await buildImportFile({ kind, format, purpose: 'template' });
        expect(output.fileName).toBe(`${kind}-template.${format}`);
        expect(output.mimeType).toContain(format === 'csv' ? 'text/csv' : 'spreadsheetml');
        const parsed = await parseImportFile({ kind, format, bytes: output.bytes });
        expect(parsed.rows).toEqual([]);
        expect(parsed.headers).toEqual(
          kind === 'items'
            ? [
                ...itemHeader.split(','),
                'costo_unitario',
                'existencia_minima',
                'cantidad_preparacion',
                'vida_util_dias',
              ]
            : [
                'producto_id',
                'variante_id',
                'rendimiento',
                'unidad_rendimiento',
                'ingrediente_codigo',
                'cantidad',
                'unidad',
              ],
        );
      }
    },
  );

  it('creates all-field guides and separate valid examples with caller labels', async () => {
    const { buildImportFile, parseImportFile } = await import('./format.js');
    const guide = await buildImportFile({
      kind: 'items',
      format: 'csv',
      purpose: 'guide',
      labels: { columns: { nombre: 'Translated description' } },
    });
    const text = new TextDecoder().decode(guide.bytes);
    expect(text).toContain('Translated description');
    expect(text).toContain('vida_util_dias');
    expect(text).toContain('ingredient');
    expect(text).toContain('liter');
    const example = await buildImportFile({ kind: 'items', format: 'csv', purpose: 'examples' });
    expect(
      (await parseImportFile({ kind: 'items', format: 'csv', bytes: example.bytes })).rows[0].values
        .codigo,
    ).toBe('LECHE-001');
  });

  it('exports typed CSV references and explicit text cells in Excel', async () => {
    const { buildImportFile } = await import('./format.js');
    const references = {
      items: [
        { publicReference: '001', displayName: '=Milk', baseUnit: 'liter', quantityScale: 3 },
      ],
      targets: [{ productId: 'p1', productName: 'Latte', variantId: 'v1', variantName: 'Grande' }],
    };
    const csv = await buildImportFile({
      kind: 'recipes',
      format: 'csv',
      purpose: 'references',
      references,
    });
    const text = new TextDecoder().decode(csv.bytes);
    expect(text).toContain('ingredient');
    expect(text).toContain('target');
    expect(text).toContain("'=Milk");
    const xlsx = await buildImportFile({
      kind: 'recipes',
      format: 'xlsx',
      purpose: 'references',
      references,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.bytes);
    expect(workbook.getWorksheet('Ingredientes').getCell('A2').value).toBe('001');
    expect(workbook.getWorksheet('Ingredientes').getCell('B2').value).toBe('=Milk');
    expect(workbook.getWorksheet('Ingredientes').getCell('D2').value).toBe('3');
    expect(workbook.getWorksheet('Productos').getRow(2).values.slice(1)).toEqual([
      'p1',
      'Latte',
      'v1',
      'Grande',
    ]);
  });

  it.each(['csv', 'xlsx'])('exports every result with safe cell text in %s', async (format) => {
    const { buildImportFile } = await import('./format.js');
    const results = [
      { rowNumber: 2, reference: '001', status: 'created', message: '=danger' },
      { rowNumber: 3, reference: '002', status: 'error', message: 'Invalid' },
    ];
    const output = await buildImportFile({ kind: 'items', format, purpose: 'results', results });
    if (format === 'csv') {
      expect(Papa.parse(new TextDecoder().decode(output.bytes)).data.slice(1)).toEqual([
        ['2', '001', 'created', "'=danger"],
        ['3', '002', 'error', 'Invalid'],
      ]);
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(output.bytes);
      expect(workbook.getWorksheet('Resultados').rowCount).toBe(3);
      expect(workbook.getWorksheet('Resultados').getCell('D2').value).toBe('=danger');
    }
  });
});

describe('inventory worker client', () => {
  let worker;
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  function installWorker() {
    class TestWorker {
      constructor() {
        worker = this;
      }
      postMessage(message, transfer) {
        this.request = message;
        this.transfer = transfer;
      }
      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', TestWorker);
  }

  it.each(['parse', 'build'])(
    'sends %s work off-thread and terminates on success',
    async (action) => {
      installWorker();
      const { runImportFileTask } = await import('./file-client.js');
      const payload = { kind: 'items', format: 'csv', bytes: encoded(itemHeader) };
      const task = runImportFileTask(action, payload);
      expect(worker.request).toEqual({ action, payload });
      expect(worker.transfer).toEqual(action === 'parse' ? [payload.bytes] : []);
      worker.onmessage({ data: { ok: true, result: { rows: [] } } });
      await expect(task).resolves.toEqual({ rows: [] });
      expect(worker.terminated).toBe(true);
    },
  );

  it('preserves adapter errors and terminates on failure', async () => {
    installWorker();
    const { runImportFileTask } = await import('./file-client.js');
    const task = runImportFileTask('parse', {});
    worker.onmessage({ data: { ok: false, error: { code: 'MISSING_HEADER' } } });
    await expect(task).rejects.toMatchObject({ code: 'MISSING_HEADER' });
    expect(worker.terminated).toBe(true);
  });

  it('terminates on worker crashes', async () => {
    installWorker();
    const { runImportFileTask } = await import('./file-client.js');
    const task = runImportFileTask('build', {});
    worker.onerror({ preventDefault() {} });
    await expect(task).rejects.toMatchObject({ code: 'WORKER_FAILED' });
    expect(worker.terminated).toBe(true);
  });

  it('terminates after 15 seconds', async () => {
    installWorker();
    vi.useFakeTimers();
    const { runImportFileTask } = await import('./file-client.js');
    const task = runImportFileTask('parse', {});
    const rejection = expect(task).rejects.toMatchObject({ code: 'WORKER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it('terminates on abort and rejects a pre-aborted task', async () => {
    installWorker();
    const { runImportFileTask } = await import('./file-client.js');
    const controller = new AbortController();
    const task = runImportFileTask('parse', {}, { signal: controller.signal });
    controller.abort();
    await expect(task).rejects.toMatchObject({ code: 'ABORTED' });
    expect(worker.terminated).toBe(true);
    await expect(
      runImportFileTask('parse', {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('terminates when transfer fails', async () => {
    installWorker();
    const { runImportFileTask } = await import('./file-client.js');
    const task = runImportFileTask('parse', {});
    worker.onmessageerror();
    await expect(task).rejects.toMatchObject({ code: 'WORKER_FAILED' });
    expect(worker.terminated).toBe(true);
  });

  it('rejects unsupported actions before creating a worker', async () => {
    installWorker();
    const { runImportFileTask } = await import('./file-client.js');
    await expect(runImportFileTask('delete', {})).rejects.toMatchObject({
      code: 'UNSUPPORTED_ACTION',
    });
  });
});

describe('point-only amounts from real files', () => {
  const merchantId = '00000000-0000-4000-8000-000000000001';
  const productId = '00000000-0000-4000-8000-000000000002';
  const snapshot = {
    merchantId,
    targets: [{ productId, productName: 'Coffee', productActive: true }],
    recipes: [],
    items: ['MILK', 'WATER'].map((publicReference, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 3}`,
      publicReference,
      displayName: publicReference,
      itemType: 'ingredient',
      baseUnit: 'liter',
      quantityScale: 3,
      active: true,
      version: 1,
      conversions: [],
    })),
  };
  async function file(kind, encoding, rows) {
    const { parseImportFile } = await import('./format.js');
    const format = encoding === 'xlsx' ? 'xlsx' : 'csv';
    const bytes =
      format === 'xlsx'
        ? await workbookBytes(rows, kind === 'items' ? 'Articulos' : 'Recetas')
        : encoded(Papa.unparse(rows, { delimiter: encoding === 'semicolon' ? ';' : ',' }));
    return buildImportPreview({
      kind,
      snapshot,
      parsed: await parseImportFile({ kind, format, bytes }),
    });
  }
  for (const encoding of ['semicolon', 'quoted-comma', 'xlsx']) {
    it.each(['costo_unitario', 'existencia_minima', 'cantidad_preparacion'])(
      `rejects comma amounts in ${encoding} item %s`,
      async (column) => {
        const result = await file('items', encoding, [
          [...itemHeader.split(','), column],
          ['COMMA', 'Coma', 'ingredient', 'liter', '3', '1,000'],
        ]);
        expect(result.entries[0]).toMatchObject({
          status: 'error',
          command: null,
          errors: expect.arrayContaining([{ code: 'INVALID_NUMBER', column, rowNumber: 2 }]),
        });
      },
    );
    it.each(['rendimiento', 'cantidad'])(
      `rejects the whole recipe with a comma in ${encoding} %s`,
      async (column) => {
        const headers = recipeHeader.split(',');
        const invalid = [productId, '1', 'unit', 'MILK', '0.250', 'liter'];
        invalid[headers.indexOf(column)] = '1,000';
        const result = await file('recipes', encoding, [
          headers,
          invalid,
          [productId, '1', 'unit', 'WATER', '0.125', 'liter'],
        ]);
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toMatchObject({
          rowNumbers: [2, 3],
          status: 'error',
          command: null,
          errors: expect.arrayContaining([{ code: 'INVALID_NUMBER', column, rowNumber: 2 }]),
        });
      },
    );
  }
});
