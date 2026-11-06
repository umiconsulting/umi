import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ cacheDir: ".vite", plugins: [react()], build: { target: 'es2022' }, optimizeDeps: { include: ['papaparse','exceljs/dist/exceljs.min.js','read-excel-file/universal'] }, server: {host:'127.0.0.1',watch:{ignored:['**/shots/**','**/scripts/**','**/docs/**','**/*.md','**/dist/**']}}, resolve: {alias:{'@':new URL('.',import.meta.url).pathname},dedupe:['react','react-dom']} })
