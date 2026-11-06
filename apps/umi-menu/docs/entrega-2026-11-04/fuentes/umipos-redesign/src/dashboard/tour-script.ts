import type { Act } from '../../kit'
import { modules } from './data'
import type { DashboardScene, TourBeat } from './tour-model'

type Options = { beats: TourBeat[]; start: number; smallMenu: boolean; phone: boolean }

// Choreography only: cursor presses illustrate the action; set() authors its result.
export async function runDashboardTour(a: Act<DashboardScene>, { beats, start, smallMenu, phone }: Options) {
  const press = async (target: string, scroll = 'd-main-scroll') => {
    const box = a.rect(target), frame = a.rect(scroll)
    if (box.y < frame.y + 8 || box.y + box.height > frame.y + frame.height - 8) {
      await a.scroll(scroll, target, { offset: 80, duration: 500 })
      await a.wait(180)
    }
    await a.click({ at: target, x: .87, y: .62 })
  }
  const showContent = async (beat: TourBeat) => {
    a.mark(beat.id)
    await a.wait(2200)
    const main = document.querySelector<HTMLElement>('[data-target="d-main-scroll"]')
    if (main && main.scrollHeight > main.clientHeight + 120 && beat.scene.view !== 'login') {
      await a.scroll('d-main-scroll', main.scrollHeight - main.clientHeight, { duration: 1000 })
      await a.wait(1800)
    }
  }
  await a.set(beats[start].scene)
  await showContent(beats[start])
  for (let i = start + 1; i < beats.length; i++) {
    const next = beats[i], prev = beats[i - 1]
    if (next.gesture === 'credentials') {
      // Auth is independently scrollable on a short device.
      await press('d-auth-email', 'd-auth-scroll')
      await a.type('email', 'sofia@example.com', { interval: 38 })
      await press('d-auth-password', 'd-auth-scroll')
      await a.type('password', 'UmiDemo2026', { interval: 60 })
      await press('d-auth-submit', 'd-auth-scroll')
    } else if (next.gesture === 'verify' && prev.scene.view === 'login') {
      await press('d-auth-code', 'd-auth-scroll')
      await a.type('code', '135790', { interval: 140 })
      await press('d-auth-submit', 'd-auth-scroll')
    } else if (next.scene.view === prev.scene.view && next.gesture) {
      if (next.gesture === 'row') await press(`d-row-${next.scene.detail?.row ?? 0}`)
      if (next.gesture === 'edit') await press(`d-action-${next.scene.detail?.action}`)
      if (next.gesture === 'review') await press('d-review')
      if (next.gesture === 'customer-tab') {
        await a.scroll('d-main-scroll', 0, { duration: 450 })
        await press(`d-customer-${next.scene.detail?.tab}`)
      }
      if (next.gesture === 'floor-edit') await press('d-floor-edit')
    } else if (next.chapter !== prev.chapter) {
      if (next.chapter === 'profile') await a.click({ at: 'd-nav-profile', x: .85, y: .6 })
      else {
        if (smallMenu) {
          await a.click('d-menu-open')
          await a.set({ menu: true })
          await a.wait(280)
        }
        await press(`d-nav-${next.chapter}`, 'd-nav-scroll')
        if (['reports','cash','products','inventory','diagnostics'].includes(next.chapter)) {
          await a.set({ navExpanded: next.chapter })
          await a.wait(280)
          await press(`d-subnav-${next.scene.view}`, 'd-nav-scroll')
        }
      }
    } else {
      if (prev.scene.detail) {
        await press('d-back')
        await a.set({ detail: null })
      }
      await a.scroll('d-main-scroll', 0, { duration: 450 })
      const picker = phone || (modules.find(m => m.id === next.chapter)?.views.length ?? 0) > 6
      if (picker) {
        await press('d-sections')
        await a.set({ sectionOpen: true })
        await a.wait(320)
        await press(`d-section-${next.scene.view}`, 'd-section-options')
      } else await press(`d-section-${next.scene.view}`)
    }
    await a.set(next.scene)
    await showContent(next)
  }
  await a.set({ complete: true })
  a.mark('dashboard-complete')
}
