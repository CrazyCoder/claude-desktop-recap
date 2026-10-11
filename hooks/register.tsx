import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Recap } from '../types'

/** What the store keeps per session: its last recap and last activity. */
type SessionRecord = { recap?: Recap; activeAt?: number }

const recap = atom({ plugin: 'desktop-recap', key: 'recap' } as const, null)
const isDismissed = atom({ plugin: 'desktop-recap', key: 'isDismissed' } as const, false)

// The TUI's own thresholds: three minutes away (the `awayMinutes` default),
// at least three turns.
const MIN_TURNS = 3

// The prompt of @jetserge/pi-session-recap, which mimics Claude Code's recap.
const RECAP_PROMPT =
  'The user stepped away and is coming back. Write exactly 1-3 short sentences. ' +
  'Start by stating the high-level task — what they are building or debugging, not ' +
  'implementation details. Next: the concrete next step. Skip status reports and commit recaps.'

// Sessions whose record the store keeps; the least recently active go first,
// so the store stays far below its 4 MiB cap.
const MAX_SESSIONS = 200
const SESSION_PREFIX = 'session:'

let away: Timer | undefined
let isGenerating = false

function cancelAway() {
  away?.cancel()
  away = undefined
}

async function sessionKey($: EngineInterface) {
  return `${SESSION_PREFIX}${await $.session.id()}`
}

async function loadRecord($: EngineInterface) {
  return ((await $.store.get(await sessionKey($))) ?? {}) as SessionRecord
}

async function saveRecord($: EngineInterface, change: SessionRecord) {
  const key = await sessionKey($)
  const record = { ...(await loadRecord($)), ...change }
  await $.store.set(key, record)
}

// Drops the least recently active sessions past MAX_SESSIONS.
async function pruneRecords($: EngineInterface) {
  const keys = (await $.store.keys()).filter(key => key.startsWith(SESSION_PREFIX))
  if (keys.length <= MAX_SESSIONS) return
  const aged: [string, number][] = []
  for (const key of keys) {
    aged.push([key, ((await $.store.get(key)) as SessionRecord | undefined)?.activeAt ?? 0])
  }
  aged.sort((a, b) => a[1] - b[1])
  for (const [key] of aged.slice(0, keys.length - MAX_SESSIONS)) await $.store.delete(key)
}

async function show($: EngineInterface, next: Recap, isSeen: boolean) {
  await update($, recap, () => next)
  await update($, isDismissed, () => isSeen)
  await saveRecord($, { recap: next })
}

async function transcriptLength($: EngineInterface) {
  return (await $.session.messages()).length
}

// Reuses the recap already made for this point of the transcript, else asks
// the model over the session's cached transcript, as the TUI does.
async function recapNow($: EngineInterface) {
  if (isGenerating || (await $.session.turns()) < MIN_TURNS) return
  const at = await transcriptLength($)
  if ((await read($, recap))?.at === at) return

  const stored = (await loadRecord($)).recap
  if (stored !== undefined && stored.at === at) {
    await show($, stored, false)
    return
  }

  isGenerating = true
  try {
    const reply = await $.model.fork({ prompt: RECAP_PROMPT })
    // A prompt sent while the fork ran makes its answer stale.
    if (reply.isAnswered && reply.text.trim() && (await transcriptLength($)) === at) {
      await show($, { text: reply.text.trim(), at }, false)
    }
  } finally {
    isGenerating = false
  }
}

function startAway($: EngineInterface, delayMs: number) {
  cancelAway()
  away = $.clock.after(delayMs, () => void recapNow($))
}

async function markActivity($: EngineInterface) {
  await saveRecord($, { activeAt: await $.clock.now() })
}

// session.start fires on a resume, an app restart and a reload of this mod
// alike: recap only once the last activity is `awayMs` old, else wait the
// rest; with no activity on record, wait the whole delay.
async function resumeAway($: EngineInterface, awayMs: number) {
  const last = (await loadRecord($)).activeAt
  const idle = last === undefined ? 0 : (await $.clock.now()) - last
  if (idle >= awayMs) await recapNow($)
  else startAway($, awayMs - idle)
}

async function keepManualRecap($: EngineInterface, text: string) {
  cancelAway()
  await show($, { text, at: await transcriptLength($) }, true)
}

async function startSession($: EngineInterface, awayMs: number) {
  await pruneRecords($)
  await resumeAway($, awayMs)
}

async function dismiss($: EngineInterface) {
  await update($, isDismissed, () => true)
}

export const register: Register = (on, options) => {
  const awayMs = Number(options.awayMinutes) * 60 * 1000

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    void startSession($, awayMs)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    cancelAway()
    await dismiss($)
    await markActivity($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await markActivity($)
      startAway($, awayMs)
    }
    return next(e)
  })

  // A /recap the person ran counts as this point's recap: it is already in
  // the transcript, so it is kept for reuse but not drawn again.
  on('command.run', { command: 'recap' }, async ($, e, next) => {
    const result = await next(e)
    const text = result.text?.trim()
    if (text) await keepManualRecap($, text)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, recap)
    if (e.props.hasSurvey || e.props.isWorking || current === null || (await read($, isDismissed))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        <Box flexGrow={1}>
          <Text>※ recap: {current.text}</Text>
        </Box>
        <Button key="dismiss" role="dismiss" label="Dismiss" onPress={() => dismiss($)} />
      </Box>
    )
  })
}
