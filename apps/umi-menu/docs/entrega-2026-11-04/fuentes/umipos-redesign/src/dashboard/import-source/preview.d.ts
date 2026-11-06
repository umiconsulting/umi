import type { ParsedFile } from './format'
export type PreviewEntry = {key:string;rowNumbers:number[];reference:string;label:string;status:string;errors:{code:string;column:string|null;rowNumber:number}[];command:null|{operation:string;targetAggregateId:string|null;parameters:Record<string,unknown>}}
export function buildImportPreview(options:{kind:string;parsed:ParsedFile;snapshot:unknown}):{kind:string;entries:PreviewEntry[];counts:Record<string,number>}
