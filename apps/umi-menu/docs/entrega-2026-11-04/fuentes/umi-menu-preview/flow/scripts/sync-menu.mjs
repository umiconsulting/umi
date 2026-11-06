// Keep the interactive preview and the Stageshow scenes on the same version.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = new URL('../../.superpowers/brainstorm/18629-1793487079/content/', import.meta.url)
const assets = new URL('../playground/public/assets/', import.meta.url)
const reference = new URL('../playground/public/reference/menu.html', import.meta.url)
const html = readFileSync(new URL('menu-v6.html', source), 'utf8')
writeFileSync(reference, html.replaceAll('/files/', '../assets/').replace('</body>', '<script src="./menu-driver.js"></script>\n</body>'))
writeFileSync(new URL('../playground/public/menu.html', import.meta.url), html.replaceAll('/files/', './assets/'))
writeFileSync(new URL('menu-redesign.css', assets), readFileSync(new URL('menu-redesign.css', source), 'utf8').replaceAll('/files/', './'))
for (const name of ['IBMPlexSans-Regular.ttf', 'IBMPlexSans-Medium.ttf', 'IBMPlexSans-SemiBold.ttf', 'BricolageGrotesque12pt-SemiBold.ttf', 'BricolageGrotesque12pt-Bold.ttf', 'IBM-Plex-OFL.txt', 'Bricolage-OFL.txt']) {
  copyFileSync(new URL(name, source), new URL(name, assets))
}
console.log('Synced menu-v6:', fileURLToPath(reference))
