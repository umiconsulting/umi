import assert from 'node:assert/strict'
import { buildImportFile, parseImportFile } from '../src/dashboard/import-source/format.js'
import { buildImportPreview } from '../src/dashboard/import-source/preview.js'
import ExcelJS from 'exceljs'

const bytes=text=>new TextEncoder().encode(text).buffer
const headers='codigo,nombre,tipo,unidad,decimales,costo_unitario'
const parsed=await parseImportFile({kind:'items',format:'csv',bytes:bytes(headers+'\n001,Leche,ingredient,liter,3,0\n002,Avena,ingredient,liter,3,')})
assert.equal(parsed.rows[0].values.codigo,'001')
const snapshot={merchantId:'00000000-0000-4000-8000-000000000001',items:[],targets:[],recipes:[]}
const preview=buildImportPreview({kind:'items',parsed,snapshot})
assert.equal(preview.counts.new,2)
assert.equal(preview.entries[0].command.parameters.initialUnitCostMinor,0)
assert.equal('initialUnitCostMinor' in preview.entries[1].command.parameters,false)
const duplicate=await parseImportFile({kind:'items',format:'csv',bytes:bytes(headers+'\n001,Leche,ingredient,liter,3,28\n001,Avena,ingredient,liter,3,30')})
assert.equal(buildImportPreview({kind:'items',parsed:duplicate,snapshot}).counts.duplicate,2)
await assert.rejects(()=>parseImportFile({kind:'items',format:'csv',bytes:new ArrayBuffer(2097153)}),/FILE_TOO_LARGE/)
await assert.rejects(()=>parseImportFile({kind:'items',format:'csv',bytes:bytes(headers+'\n'+Array.from({length:501},(_,i)=>`${i},Leche,ingredient,liter,3,28`).join('\n'))}),/TOO_MANY_ROWS/)
const template=await buildImportFile({kind:'items',format:'xlsx',purpose:'template'})
const blank=await parseImportFile({kind:'items',format:'xlsx',bytes:template.bytes})
assert.equal(blank.rows.length,0)
const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Articulos')
sheet.addRow(headers.split(','))
sheet.addRow(['003','Fórmula','ingredient','liter','3',{formula:'1+1',result:2}])
const raw=await book.xlsx.writeBuffer()
const formula=await parseImportFile({kind:'items',format:'xlsx',bytes:raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)})
assert.equal(formula.rows[0].errors[0].code,'FORMULA_CELL')
assert.equal(buildImportPreview({kind:'items',parsed:formula,snapshot}).counts.error,1)
console.log('Import formats: CSV/XLSX, zero/unknown cost, duplicate, limits, formula rejection passed')
