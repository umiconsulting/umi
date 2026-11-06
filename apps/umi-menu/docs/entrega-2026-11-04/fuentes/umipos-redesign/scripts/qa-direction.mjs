// Presentation-only coverage for existing scenario suites; no duplicated domain cases.
import { mkdir } from 'node:fs/promises'
export async function configureDirection(page) {
  const design = process.argv.find(arg=>arg.startsWith('--design='))?.split('=')[1]
  if (!design) return
  const goto=page.goto.bind(page)
  page.goto=(address,options)=>{const url=new URL(address);url.searchParams.set('design',design);return goto(url.href,options)}
  await mkdir(`shots/full-directions/qa-${design}`,{recursive:true})
}

export const qaOutput = name => { const design = process.argv.find(arg=>arg.startsWith('--design='))?.split('=')[1]; return `shots/${design?`full-directions/qa-${design}/`:''}${name}` }
