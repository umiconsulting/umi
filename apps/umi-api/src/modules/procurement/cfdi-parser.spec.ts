import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCfdiInvoice, scaledDecimal } from './cfdi-parser';

/**
 * The CFDI reader, on the four documents that decide whether a supplier's file can be
 * trusted: a real one, one with no UUID, one whose total is not a number, and one that
 * declares an EXTERNAL ENTITY (plan D10 and §12.2).
 *
 * The external-entity case is the security claim, so it is proved the only way that
 * proves anything: the entity points at a file this test wrote, the test reads the
 * result back, and the file's own content must not appear anywhere in it.
 */

const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** A CFDI 4.0 file in the shape the SAT stamps, with two concepts. */
const validCfdi = (
  overrides: { total?: string; timbre?: string } = {},
) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="A" Folio="4471"
  Fecha="2026-09-15T10:30:00" SubTotal="1506.25" Moneda="MXN" Total="${overrides.total ?? '1747.25'}"
  TipoDeComprobante="I" LugarExpedicion="06000">
  <cfdi:Emisor Rfc="XAXX010101000" Nombre="Cafetería del Sur SA de CV" RegimenFiscal="601"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="50202300" NoIdentificacion="MOLIENDA-1KG" Cantidad="12.5"
      ClaveUnidad="KGM" Unidad="Kilogramo" Descripcion="Café molido" ValorUnitario="120.50"
      Importe="1506.25" ObjetoImp="02"/>
    <cfdi:Concepto ClaveProdServ="50202300" Cantidad="2" ClaveUnidad="H87" Unidad="Pieza"
      Descripcion="Servilletas" ValorUnitario="10.00" Importe="20.00"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="241.00"/>
  <cfdi:Complemento>
    ${
      overrides.timbre ??
      `<tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1"
      UUID="${uuid}" FechaTimbrado="2026-09-15T10:31:00"/>`
    }
  </cfdi:Complemento>
</cfdi:Comprobante>`;

describe('CFDI 4.0 parsing', () => {
  it('reads the issuer, the folio, the UUID, the totals and every concept', () => {
    const result = parseCfdiInvoice(validCfdi());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const invoice = result.invoice;
    expect(invoice.issuerRfc).toBe('XAXX010101000');
    expect(invoice.issuerName).toBe('Cafetería del Sur SA de CV');
    expect(invoice.folio).toBe('4471');
    expect(invoice.uuid).toBe(uuid);
    expect(invoice.issuedOn).toBe('2026-09-15');
    expect(invoice.currency).toBe('MXN');
    // Money is integer centavos and nothing else crosses this boundary.
    expect(invoice.subtotalMinor).toBe(150625);
    expect(invoice.taxMinor).toBe(24100);
    expect(invoice.totalMinor).toBe(174725);

    expect(invoice.concepts).toHaveLength(2);
    // The scale is the one the FILE wrote — "12.5" is 125 tenths, not 12500 grams —
    // because rescaling it here would invent a precision the document does not have.
    expect(invoice.concepts[0]).toEqual({
      lineNumber: 1,
      description: 'Café molido',
      quantity: { value: 125, scale: 1, unit: 'kilogram' },
      unitCostMinor: 12050,
      lineTotalMinor: 150625,
      supplierSku: 'MOLIENDA-1KG',
    });
    // A concept with no `NoIdentificacion` carries no supplier SKU rather than an
    // empty string, which is what stops an empty SKU matching every item.
    expect(invoice.concepts[1].supplierSku).toBeNull();
    expect(invoice.concepts[1].quantity).toEqual({ value: 2, scale: 0, unit: 'unit' });
    expect(Number.isInteger(invoice.concepts[1].lineTotalMinor)).toBe(true);
  });

  it('matches on the local name, so an unprefixed document parses the same way', () => {
    const withoutPrefixes = validCfdi()
      .replace(/cfdi:/g, '')
      .replace(/tfd:/g, '')
      .replace(/xmlns="http:\/\/www.sat.gob.mx\/cfd\/4"/g, '');
    const result = parseCfdiInvoice(withoutPrefixes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.uuid).toBe(uuid);
    expect(result.invoice.concepts).toHaveLength(2);
  });

  it('refuses a document whose timbre carries no UUID', () => {
    const result = parseCfdiInvoice(
      validCfdi({
        timbre: '<tfd:TimbreFiscalDigital Version="1.1" FechaTimbrado="2026-09-15T10:31:00"/>',
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'INVALID_UUID' });
  });

  it('refuses a document with no timbre at all', () => {
    const noComplemento = validCfdi().replace(/<cfdi:Complemento>[\s\S]*<\/cfdi:Complemento>/, '');
    expect(parseCfdiInvoice(noComplemento)).toMatchObject({ ok: false, code: 'NO_TIMBRE' });
  });

  it('refuses a total that is not a decimal number', () => {
    const result = parseCfdiInvoice(validCfdi({ total: 'mil setecientos' }));
    expect(result).toMatchObject({ ok: false, code: 'INVALID_TOTAL' });
  });

  it('refuses a document that is not XML at all', () => {
    expect(parseCfdiInvoice('factura.pdf')).toMatchObject({ ok: false, code: 'NOT_XML' });
  });

  it('rounds a money string once, half up, and never through a float', () => {
    expect(scaledDecimal('1506.255', 2)).toBe(150626n);
    expect(scaledDecimal('1506.254', 2)).toBe(150625n);
    expect(scaledDecimal('12.05', 2)).toBe(1205n);
    expect(scaledDecimal('12.5', 2)).toBe(1250n);
    expect(scaledDecimal('0.005', 2)).toBe(1n);
    expect(scaledDecimal('120.50', 2)).toBe(12050n);
    // Not a decimal, so not a number at all.
    expect(scaledDecimal('1e3', 2)).toBeNull();
    expect(scaledDecimal('-12.00', 2)).toBeNull();
    expect(scaledDecimal('', 2)).toBeNull();
  });

  it('never resolves an external entity, and never reads the file it names', () => {
    // A file that exists and carries text no CFDI would ever contain. If the parser
    // resolved the entity, this string would end up in the parsed description.
    const directory = mkdtempSync(join(tmpdir(), 'umi-cfdi-'));
    const secretPath = join(directory, 'secret.txt');
    const secret = 'UMI-EXTERNAL-ENTITY-MUST-NOT-BE-READ';
    writeFileSync(secretPath, secret, 'utf8');

    const hostile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cfdi:Comprobante [ <!ENTITY xxe SYSTEM "file://${secretPath}"> ]>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Folio="1"
  Fecha="2026-09-15T10:30:00" SubTotal="100.00" Moneda="MXN" Total="116.00">
  <cfdi:Emisor Rfc="XAXX010101000" Nombre="&xxe;"/>
  <cfdi:Conceptos>
    <cfdi:Concepto Cantidad="1" ClaveUnidad="H87" Descripcion="&xxe;" ValorUnitario="100.00" Importe="100.00"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="${uuid}"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

    const result = parseCfdiInvoice(hostile);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EXTERNAL_ENTITY');
    // The whole answer, as JSON, carries no byte of the file the entity named.
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('leaves an internal entity unexpanded rather than resolving it', () => {
    const internal = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE comprobante [ <!ENTITY sku "MOLIENDA-1KG"> ]>
<Comprobante Version="4.0" Folio="2" Fecha="2026-09-15T10:30:00" SubTotal="100.00"
  Moneda="MXN" Total="116.00">
  <Emisor Rfc="XAXX010101000" Nombre="Proveedor"/>
  <Conceptos>
    <Concepto Cantidad="1" ClaveUnidad="H87" NoIdentificacion="&sku;"
      Descripcion="Café molido" ValorUnitario="100.00" Importe="100.00"/>
  </Conceptos>
  <Complemento><TimbreFiscalDigital UUID="${uuid}"/></Complemento>
</Comprobante>`;

    const result = parseCfdiInvoice(internal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The literal text is kept. Nothing ran an entity resolver over the file.
    expect(result.invoice.concepts[0].supplierSku).toBe('&sku;');
  });
});
