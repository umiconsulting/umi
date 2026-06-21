import { assertEquals } from 'jsr:@std/assert'
import { decideTurnIntegrity, isRevisionLike } from './turns.ts'

Deno.test('isRevisionLike detects common correction patterns', () => {
  assertEquals(isRevisionLike('no, mejor chico'), true)
  assertEquals(isRevisionLike('cámbialo a avena'), true)
  assertEquals(isRevisionLike('quiero un latte'), false)
})

Deno.test('decideTurnIntegrity holds recent single message turns', () => {
  const now = new Date('2026-04-01T12:00:00.500Z')
  const decision = decideTurnIntegrity({
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'quiero un latte',
        created_at: '2026-04-01T12:00:00.000Z',
      },
    ],
    currentState: 'initial',
    pendingClarification: null,
    now,
  })

  assertEquals(decision?.decision, 'merge')
})

Deno.test('decideTurnIntegrity releases settled turns', () => {
  const now = new Date('2026-04-01T12:00:03.200Z')
  const decision = decideTurnIntegrity({
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'quiero un latte',
        created_at: '2026-04-01T12:00:00.000Z',
      },
    ],
    currentState: 'initial',
    pendingClarification: null,
    now,
  })

  assertEquals(decision?.decision, 'release')
})

Deno.test('decideTurnIntegrity extends hold for fragmented revisions', () => {
  const now = new Date('2026-04-01T12:00:01.100Z')
  const decision = decideTurnIntegrity({
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'quiero un chai',
        created_at: '2026-04-01T12:00:00.000Z',
      },
      {
        id: 'm2',
        role: 'user',
        content: 'no mejor matcha',
        created_at: '2026-04-01T12:00:00.900Z',
      },
    ],
    currentState: 'awaiting_confirmation',
    pendingClarification: { kind: 'confirm_order' },
    now,
  })

  assertEquals(decision?.decision, 'merge')
})
