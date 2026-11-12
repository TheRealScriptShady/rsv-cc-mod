import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { MODE_LABEL, MODES, type Mode, type Msg, cleanText } from './rsvp'

const PANE = 'rsvp'
const TITLE = 'RSVP reader'
/** What the reader's props may hold, under the 100,000-character cap. */
const BUDGET = 90_000
const rev = atom({ plugin: 'rsvp-reader', key: 'rev' } as const, 0)

const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode)
const ALIASES: Record<string, Mode> = {
  latest: 'latest', last: 'latest',
  claude: 'claude', replies: 'claude',
  all: 'all', thread: 'all', whole: 'all',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rsvp',
      description: 'Open the RSVP speed reader beside the chat',
      argumentHint: '[latest|claude|all]',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'rsvp' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: TITLE })
    const mode = ALIASES[e.args.trim().toLowerCase()]
    if (mode) {
      await $.store.set('mode', mode)
      await $.store.set('modeSeq', Number((await $.store.get('modeSeq')) ?? 0) + 1)
      await update($, rev, n => n + 1) // redraw the pane with the new view
      return { text: `RSVP reader: ${MODE_LABEL[mode]}. Click it, then Space.` }
    }
    return { text: 'RSVP reader open. Click it, then Space.' }
  })

  // A reply finished: redraw the pane so it picks up the newest text.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await update($, rev, n => n + 1)
    return r
  })

  // The reader saves its speed and view as they change.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const d = (e.data ?? {}) as { wpm?: unknown; mode?: unknown }
    if (typeof d.wpm === 'number') await $.store.set('wpm', d.wpm)
    if (isMode(d.mode)) await $.store.set('mode', d.mode)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const n = await read($, rev)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return <Text dimColor>The live reader needs the desktop app or the terminal.</Text>
    }
    const { Client } = $.ui.resolve(e)

    const all: Msg[] = []
    for (const m of await $.session.messages()) {
      const t = cleanText(m.text)
      if (t !== '') all.push({ r: m.role === 'user' ? 'u' : 'a', t })
    }
    // Keep the newest messages that fit.
    const kept: Msg[] = []
    let size = 0
    for (let k = all.length - 1; k >= 0; k--) {
      const msg = all[k]
      if (!msg) continue
      size += msg.t.length + 16
      if (size > BUDGET && kept.length > 0) break
      kept.unshift(size > BUDGET ? { ...msg, t: msg.t.slice(-BUDGET) } : msg)
    }

    const wpm = Number((await $.store.get('wpm')) ?? 300)
    const savedMode = await $.store.get('mode')
    const modeSeq = Number((await $.store.get('modeSeq')) ?? 0)
    return (
      <Box flexDirection="column">
        <Client
          key="reader"
          module="./reader.tsx"
          props={{
            id: `${n}:${all.length}`,
            msgs: kept,
            dropped: all.length - kept.length,
            wpm: Number.isFinite(wpm) ? wpm : 300,
            mode: isMode(savedMode) ? savedMode : 'latest',
            modeSeq,
          }}
        />
      </Box>
    )
  })
}
