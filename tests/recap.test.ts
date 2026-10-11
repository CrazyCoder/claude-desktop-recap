import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
} as unknown as RenderPropsOf['AbovePrompt']

const TURN = { answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', text: 'done' } as never

// A session start as a resume, an app restart or a reload of the mod raises it.
const START = { cwd: '/work', surface: 'desktop', isInteractive: false } as const

const AWAY_MS = 3 * 60 * 1000

function world(on: On, turns: number, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on)
  const stored = new Map(Object.entries(store))
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    stored.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  let forks = 0
  let length = turns * 2
  let onFork = () => {}
  on('turn.complete', () => ({ text: 'done' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  // The engine's own band: empty.
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }) as never)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.turns', () => ({ value: turns }))
  on('session.messages', () => ({
    value: Array.from({ length }, () => ({ role: 'user', text: 'x', toolUses: [] })) as never,
  }))
  on('model.fork', () => {
    forks += 1
    onFork()
    return { value: { isAnswered: true, text: ' Fixing the build. Next: rerun it. ', usage: {} } as never }
  })
  return {
    clock,
    stored,
    forks: () => forks,
    // Runs while the next fork is in flight.
    duringFork: (fn: () => void) => {
      onFork = fn
    },
    grow: () => {
      length += 2
    },
  }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: recaps after three idle minutes and reuses it`, async ($, on) => {
    const { clock, forks } = world(on, 4)

    await $.turn.complete(TURN)
    await clock.advance(AWAY_MS - 1)
    expect(forks()).toBe(0)
    await clock.advance(1)
    await clock.settle()
    expect(forks()).toBe(1)

    const band = await $.ui.mount({ plugin: 'desktop-recap', surface, component: 'AbovePrompt', props: BAND })
    expect((await band.find({ text: /recap: Fixing the build\. Next: rerun it\.$/ }))?.text).toBeDefined()

    // Nothing new happened: the next idle period reuses the recap.
    await $.turn.complete(TURN)
    await clock.advance(AWAY_MS)
    await clock.settle()
    expect(forks()).toBe(1)

    await band.press({ key: 'dismiss' })
    expect(await band.find({ text: /recap:/ })).toBeUndefined()
  })

  test(`${surface}: the next prompt takes the recap down`, async ($, on) => {
    const { clock } = world(on, 4)
    await $.turn.complete(TURN)
    await clock.advance(AWAY_MS)
    await clock.settle()

    const band = await $.ui.mount({ plugin: 'desktop-recap', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /recap:/ })).toBeDefined()
    await $.prompt.submit({ text: 'go on' } as never)
    expect(await band.find({ text: /recap:/ })).toBeUndefined()
  })
}

test('awayMinutes sets the idle delay', { options: { awayMinutes: 10 } }, async ($, on) => {
  const { clock, forks } = world(on, 4)
  await $.turn.complete(TURN)
  await clock.advance(AWAY_MS)
  await clock.settle()
  expect(forks()).toBe(0)
  await clock.advance(10 * 60 * 1000 - AWAY_MS)
  await clock.settle()
  expect(forks()).toBe(1)
})

test('a session.start soon after a reply waits out the rest of the delay', async ($, on) => {
  const { clock, forks } = world(on, 4)
  await $.turn.complete(TURN)
  await clock.advance(60 * 1000)

  await $.session.start(START)
  await clock.settle()
  expect(forks()).toBe(0)

  await clock.advance(AWAY_MS - 60 * 1000)
  await clock.settle()
  expect(forks()).toBe(1)
})

test('a session.start long after the last reply recaps at once', async ($, on) => {
  const { clock, forks } = world(on, 4)
  await $.turn.complete(TURN)
  await $.prompt.submit({ text: 'cancels the timer' } as never)
  await clock.advance(AWAY_MS)

  await $.session.start(START)
  await clock.settle()
  expect(forks()).toBe(1)
})

test('a recap whose transcript moved on while it was drafted is dropped', async ($, on) => {
  const { clock, forks, duringFork, grow } = world(on, 4)
  duringFork(grow)
  await $.turn.complete(TURN)
  await clock.advance(AWAY_MS)
  await clock.settle()
  expect(forks()).toBe(1)

  const band = await $.ui.mount({ plugin: 'desktop-recap', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: /recap:/ })).toBeUndefined()
})

test('the store keeps the most recently active sessions', async ($, on) => {
  const old: Record<string, unknown> = {}
  for (let i = 0; i < 200; i++) old[`session:old-${i}`] = { activeAt: i }
  const { clock, stored } = world(on, 4, old)
  await clock.set(1000)

  await $.session.start(START)
  await clock.settle()
  expect(stored.size).toBe(200)

  // This session's first record makes 201: the least recently active goes.
  await $.turn.complete(TURN)
  await $.session.start(START)
  await clock.settle()
  expect(stored.size).toBe(200)
  expect(stored.has('session:session-1')).toBe(true)
  expect(stored.has('session:old-0')).toBe(false)
  expect(stored.has('session:old-1')).toBe(true)
})

test('no recap before three turns', async ($, on) => {
  const { clock, forks } = world(on, 2)
  await $.turn.complete(TURN)
  await clock.advance(AWAY_MS)
  await clock.settle()
  expect(forks()).toBe(0)
})
