export type ParsedRow = { rowNumber:number; values:Record<string,string>; errors:{code:string;column:string|null}[] }
export type ParsedFile = { headers:string[]; rows:ParsedRow[] }
export function parseImportFile(options:{kind:string;format:string;bytes:ArrayBuffer}):Promise<ParsedFile>
export function buildImportFile(options:{kind:string;format:string;purpose:string;references?:unknown;results?:unknown;labels?:unknown}):Promise<{bytes:ArrayBuffer;mimeType:string;fileName:string}>
