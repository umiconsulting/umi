import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Pure Act checks. No browser, app server, product API or source edits are used.
// The controllable clock models a hidden tab that delivers no animation frames.
const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await mkdtemp(join(tmpdir(), 'umi-stage-pause-'))
const bundle = join(temp, 'act.cjs')
const require = createRequire(import.meta.url)
await build({ entryPoints: [join(root, 'kit/act.ts')], bundle: true, format: 'cjs', platform: 'node', outfile: bundle })
const { createAct, Stopped } = require(bundle)

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const ref = current => ({ current })
const node = () => {
  const attributes = new Map()
  return {
    parentElement: null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
    hasAttribute: key => attributes.has(key),
    toggleAttribute: (key, enabled) => enabled ? attributes.set(key, '') : attributes.delete(key),
    querySelectorAll: () => [],
    querySelector: () => null,
  }
}

class Clock {
  now = 0
  next = 0
  frames = new Map()
  timers = new Map()
  originals = new Map()

  install() {
    for (const [key, value] of Object.entries({
      performance: { now: () => this.now },
      requestAnimationFrame: callback => { const id = ++this.next; this.frames.set(id, callback); return id },
      cancelAnimationFrame: id => this.frames.delete(id),
      setTimeout: (callback, ms = 0) => { const id = ++this.next; this.timers.set(id, { at: this.now + ms, callback }); return id },
      clearTimeout: id => this.timers.delete(id),
    })) {
      this.originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  }

  restore() {
    for (const [key, descriptor] of this.originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }

  elapse(ms) { this.now += ms }

  async frame(ms = 0) {
    this.elapse(ms)
    for (const [id, callback] of [...this.frames]) {
      this.frames.delete(id)
      callback(this.now)
    }
    await flush()
  }

  async timersAt(ms = 0) {
    this.elapse(ms)
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.now) {
        this.timers.delete(id)
        timer.callback()
      }
    }
    await flush()
  }
}

function fixture(clock) {
  const rootNode = node(), cursorNode = node(), scrollNode = node()
  Object.assign(scrollNode, { scrollTop: 0, scrollHeight: 300, clientHeight: 100 })
  rootNode.querySelector = selector => selector === '[data-target="scroll"]' ? scrollNode : null
  const updates = [], positions = []
  let pausedAt = null, pausedElapsed = 0, state = {}
  const env = {
    rootRef: ref(rootNode), cursorRef: ref(cursorNode), pos: ref({ x: 0, y: 0 }),
    hovered: ref(null), kindRef: ref('pointer'), keysRef: ref({ id: 0, caps: [], show: false, down: false }),
    dragging: ref(false), autoUsed: ref(false), autoRef: ref(null), scaleRef: ref(1),
    speed: 1, pausedRef: ref(false), layout: 'wide',
    // This is the clock contract Stage supplies. Act must use it for elapsed time.
    activeNow: () => clock.now - pausedElapsed - (pausedAt === null ? 0 : clock.now - pausedAt),
    resolve: target => typeof target === 'object' ? target : { x: 100, y: 0 },
    place: point => { env.pos.current = point; positions.push({ ...point }) },
    remeasure: () => {}, ripple: () => {}, setKind: () => {}, setKeys: () => {}, setLastKeys: () => {},
    setState: update => { state = typeof update === 'function' ? update(state) : update; updates.push({ ...state }) },
  }
  const pause = next => {
    if (next && !env.pausedRef.current) pausedAt = clock.now
    if (!next && env.pausedRef.current) { pausedElapsed += clock.now - pausedAt; pausedAt = null }
    env.pausedRef.current = next
  }
  const controller = new AbortController()
  return { env, pause, controller, act: createAct(controller.signal, env), cursorNode, scrollNode, positions, updates }
}

const results = []
async function check(name, run) {
  const clock = new Clock()
  clock.install()
  try {
    await run(clock)
    results.push(name)
    console.log('PASS', name)
  } finally { clock.restore() }
}

try {
  await check('Cursor resumes its pose after a full pause between frames', async clock => {
    const f = fixture(clock)
    let finished = false
    const pending = f.act.move({ x: 100, y: 0 }, { duration: 100 }).then(() => { finished = true })
    clock.elapse(10)
    f.pause(true)
    clock.elapse(1000) // No requestAnimationFrame callback while hidden.
    f.pause(false)
    await clock.frame()
    assert.equal(finished, false, 'The hidden time must not complete the movement')
    assert.ok(f.env.pos.current.x > 0 && f.env.pos.current.x < 10, 'Only 10 ms of active time elapsed')
    await clock.frame(90)
    await pending
    assert.equal(f.env.pos.current.x, 100)
  })

  await check('Scroll preserves remaining travel after a hidden interval', async clock => {
    const f = fixture(clock)
    let finished = false
    const pending = f.act.scroll('scroll', 200, { duration: 100 }).then(() => { finished = true })
    clock.elapse(10)
    f.pause(true)
    clock.elapse(4000)
    f.pause(false)
    await clock.frame()
    assert.equal(finished, false)
    assert.ok(f.scrollNode.scrollTop > 0 && f.scrollNode.scrollTop < 20)
    await clock.frame(90)
    await pending
    assert.equal(f.scrollNode.scrollTop, 200)
  })

  await check('A delayed timer excludes a pause that begins and ends before delivery', async clock => {
    const f = fixture(clock)
    let finished = false
    const pending = f.act.wait(100).then(() => { finished = true })
    await flush()
    clock.elapse(10)
    f.pause(true)
    clock.elapse(1000)
    f.pause(false)
    await clock.timersAt()
    assert.equal(finished, false)
    await clock.timersAt(60)
    assert.equal(finished, false)
    await clock.timersAt(30)
    await pending
    assert.equal(finished, true)
  })

  await check('Aborting a paused set prevents state writes and cancels its timer', async clock => {
    const f = fixture(clock)
    f.pause(true)
    const pending = f.act.set({ view: 'must-not-appear' })
    await flush()
    assert.equal(f.updates.length, 0)
    assert.ok(clock.timers.size > 0)
    f.controller.abort()
    await assert.rejects(pending, Stopped)
    assert.equal(clock.timers.size, 0)
    f.act.put({ view: 'also-forbidden' })
    assert.equal(f.updates.length, 0)
  })

  await check('Aborting a movement cancels its frame and prevents later pose updates', async clock => {
    const f = fixture(clock)
    const pending = f.act.move({ x: 100, y: 0 }, { duration: 100 })
    await clock.frame(10)
    const pose = { ...f.env.pos.current }, count = f.positions.length
    f.controller.abort()
    await assert.rejects(pending, Stopped)
    assert.equal(clock.frames.size, 0)
    await clock.frame(1000)
    assert.deepEqual(f.env.pos.current, pose)
    assert.equal(f.positions.length, count)
  })

  await check('Aborting a press clears its ownership without clearing a later press', async clock => {
    const f = fixture(clock)
    const pending = f.act.click()
    await flush()
    assert.equal(f.cursorNode.hasAttribute('data-pressed'), true)
    f.controller.abort()
    assert.equal(f.cursorNode.hasAttribute('data-pressed'), false)
    f.cursorNode.setAttribute('data-pressed', 'next-run')
    await assert.rejects(pending, Stopped)
    assert.equal(f.cursorNode.hasAttribute('data-pressed'), true, 'The old finally block cannot clear a new press')
    assert.equal(clock.timers.size, 0)
  })

  console.log(JSON.stringify({ checks: results.length, failures: 0, scope: 'Act clock and cancellation only; browser lifecycle remains unverified' }))
} finally {
  await rm(temp, { recursive: true, force: true })
}
