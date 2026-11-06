// Run existing suites unchanged in semantics against a selected POS design. Adapt this
// workstation's installed browser and put all generated evidence in separate design folders.
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const allowed=['three-flows-qa','redesign-flow-qa','pos-parity-qa','operations-qa','payment-layout-qa','device-qa','access-qa','redesign-qa']
const design=process.env.POS_DESIGN||'2', output=design==='3'?'shots/option3':'shots/option2-revision'
const name=process.argv[2]
if(!allowed.includes(name))throw new Error('Unknown QA suite')
let source=await readFile(new URL(`./${name}.mjs`,import.meta.url),'utf8')
source=source.replaceAll('chromium_headless_shell-1243','chromium_headless_shell-1234').replaceAll('shots/',output+'/')
source=source.replaceAll("page.goto(","gotoVariant(")
const insert=`const gotoVariant=(url,...args)=>{const target=new URL(url);if(!target.searchParams.has('app')||target.searchParams.get('app')==='pos')target.searchParams.set('design','${design}');return page.goto(target.toString(),...args)};\n`
const marker=name==='payment-layout-qa'?' const failures=[]':'page.on('
const index=source.indexOf(marker)
source=source.slice(0,index)+insert+source.slice(index)
const path=new URL(`./.option${design}-${name}.mjs`,import.meta.url)
await mkdir(output,{recursive:true});await writeFile(path,source)
try {const result=spawnSync(process.execPath,[path.pathname],{encoding:'utf8'});await writeFile(`${output}/${name}.log`,result.stdout+'\n'+result.stderr);console.log(result.stdout);console.error(result.stderr);process.exitCode=result.status??1}finally{await unlink(path)}
