import type { ClientModule, JsonValue } from 'claude-code'
import {
  MODE_LABEL,
  MODES,
  type Mode,
  type Msg,
  type Tok,
  delayMs,
  nextSentence,
  orpIndex,
  pickMessages,
  prevSentence,
  sentenceStarts,
  startOf,
  tokenize,
} from './rsvp'

/** What the pane's hook hands the reader. */
export type ReaderProps = {
  /** Changes when the thread changes. */
  id: string
  msgs: Msg[]
  /** Older messages left out to fit the size limit. */
  dropped: number
  /** Saved settings, and a counter bumped when /rsvp asks for a mode. */
  wpm: number
  mode: Mode
  modeSeq: number
}

type Model = {
  id: string
  mode: Mode
  modeSeq: number
  i: number
  playing: boolean
  wpm: number
  showCode: boolean
}

const SIDE = 12 // characters each side of the focus letter
const WPM_MIN = 150
const WPM_MAX = 900
const WPM_STEP = 25
const clampWpm = (w: number) => Math.min(WPM_MAX, Math.max(WPM_MIN, Math.round(w)))
const CLAUDE = '#D97757'
const YOU = '#5B9BD5'
const FOCUS = '#FF5555'
const TRACK = '#3A3A3A'

// One reader instance at a time: what its timer and handlers read.
let props: ReaderProps = { id: '', msgs: [], dropped: 0, wpm: 300, mode: 'latest', modeSeq: 0 }
let set: (m: Model) => void = () => {}
let barWidth = 40
/** Whether a key has reached the reader yet (it has the focus). */
let heard = false
const cache = { key: '', msgs: [] as Msg[], toks: [] as Tok[], starts: [] as number[] }

function data(mode: Mode) {
  const key = `${props.id}|${mode}`
  if (cache.key !== key) {
    const msgs = pickMessages(props.msgs, mode)
    const toks = tokenize(msgs)
    Object.assign(cache, { key, msgs, toks, starts: sentenceStarts(toks) })
  }
  return cache
}

const Reader: ClientModule<ReaderProps & { [k: string]: JsonValue }, Model> = (p, s) => {
  const { Box, Text, Button, Code } = s.elements
  props = p
  barWidth = Math.max(10, (s.columns || 42) - 2) // less the side padding
  let m = s.state

  if (m === undefined) {
    let stop: (() => void) | undefined
    const schedule = (cur: Model) => {
      stop?.()
      stop = undefined
      const { toks } = data(cur.mode)
      const tok = toks[cur.i]
      if (!cur.playing || !tok || tok.code) return
      stop = s.every(delayMs(tok, cur.wpm), () => {
        const now = s.state
        if (!now) return
        const total = data(now.mode).toks.length
        const i = Math.min(total, now.i + 1)
        const nextTok = data(now.mode).toks[i]
        // Stop at the end, and on a code block (it is never flashed).
        set({ ...now, i, playing: i < total && !nextTok?.code })
      })
    }
    set = next => {
      s.setState(next)
      schedule(next)
    }
    const save = (cur: Model) => s.post({ wpm: cur.wpm, mode: cur.mode })
    const jump = (cur: Model, i: number) => set({ ...cur, i, showCode: false })

    s.onKey(k => {
      const cur = s.state
      if (!cur) return
      heard = true
      const { toks, starts } = data(cur.mode)
      const total = toks.length
      const key = k.key
      if (key === ' ' || key === 'space' || key === 'return') {
        if (cur.i >= total) return set({ ...cur, i: 0, playing: true })
        // Paused on a code block: Space moves past it.
        if (!cur.playing && toks[cur.i]?.code) {
          return set({ ...cur, i: cur.i + 1, playing: cur.i + 1 < total, showCode: false })
        }
        return set({ ...cur, playing: !cur.playing })
      }
      if (key === 'up' || key === '+' || key === '=' || key === 'down' || key === '-' || key === '_') {
        const up = key === 'up' || key === '+' || key === '='
        const next = { ...cur, wpm: clampWpm(cur.wpm + (up ? WPM_STEP : -WPM_STEP)) }
        set(next)
        return save(next)
      }
      if (key === 'left') return jump(cur, prevSentence(starts, Math.min(cur.i, total - 1)))
      if (key === 'right') return jump(cur, nextSentence(starts, cur.i, total))
      if (key === 'c' && toks[cur.i]?.code) return set({ ...cur, playing: false, showCode: !cur.showCode })
      const mode = MODES[Number(key) - 1]
      if (mode && mode !== cur.mode) {
        const next = { ...cur, mode, i: 0, playing: false, showCode: false }
        set(next)
        return save(next)
      }
    })

    s.onPointer(e => {
      const cur = s.state
      if (!cur || e.type !== 'down' || e.y !== 0) return
      heard = true
      const { toks, starts } = data(cur.mode)
      if (toks.length === 0) return
      const at = Math.min(toks.length - 1, Math.floor((Math.max(0, e.x - 1) / barWidth) * toks.length))
      jump(cur, startOf(starts, at))
    })

    m = { id: p.id, mode: p.mode, modeSeq: p.modeSeq, i: 0, playing: false, wpm: clampWpm(p.wpm), showCode: false }
    set(m)
  } else if (m.modeSeq !== p.modeSeq) {
    // /rsvp <mode> was run.
    m = { ...m, id: p.id, mode: p.mode, modeSeq: p.modeSeq, i: 0, playing: false, showCode: false }
    set(m)
  } else if (m.id !== p.id) {
    // The thread grew. The latest-reply view starts over on the new reply;
    // the others keep their place (new text was appended after it).
    const total = data(m.mode).toks.length
    const i = m.mode === 'latest' ? 0 : Math.min(m.i, total)
    m = { ...m, id: p.id, i, playing: m.mode === 'latest' ? false : m.playing, showCode: false }
    set(m)
  }

  const { msgs, toks } = data(m.mode)
  const total = toks.length
  const done = total > 0 && m.i >= total
  const tok = toks[Math.min(m.i, total - 1)]
  const msg = tok ? msgs[tok.m] : undefined
  const isYou = msg?.r === 'u'
  const pct = total === 0 ? 0 : Math.round((Math.min(m.i, total) / total) * 100)

  const choose = (mode: Mode) => {
    const cur = s.state
    if (!cur || cur.mode === mode) return
    const next = { ...cur, mode, i: 0, playing: false, showCode: false }
    set(next)
    s.post({ wpm: next.wpm, mode })
  }
  const modeRow = (
    <Box flexDirection="row" gap={2} flexWrap="wrap" justifyContent="center">
      {MODES.map((mode, k) => (
        <Button
          key={`mode-${mode}`}
          plain
          hotkey={String(k + 1)}
          label={`${mode === m.mode ? '\u25cf' : '\u25cb'} ${MODE_LABEL[mode]}`}
          onPress={() => choose(mode)}
        />
      ))}
    </Box>
  )

  if (total === 0) {
    return (
      <Box flexDirection="column" gap={1} paddingX={1} paddingY={1} alignItems="center">
        <Text dimColor>Nothing to read in this view yet.</Text>
        {modeRow}
      </Box>
    )
  }

  let stage
  if (tok?.code && m.showCode && !done) {
    stage = (
      <Box flexDirection="column" gap={1}>
        <Code source={tok.code.source} language={tok.code.lang || undefined} />
        <Box justifyContent="center">
          <Button key="code-back" label="Back to reading (c)" onPress={() => {
            const cur = s.state
            if (cur) set({ ...cur, showCode: false })
          }} />
        </Box>
      </Box>
    )
  } else if (tok?.code && !done) {
    stage = (
      <Box flexDirection="column" alignItems="center" paddingY={2} gap={1}>
        <Text size="title" bold color={CLAUDE}>{tok.w}</Text>
        <Button key="code-view" label="View code (c)" onPress={() => {
          const cur = s.state
          if (cur) set({ ...cur, playing: false, showCode: true })
        }} />
        <Text dimColor>Space skips past it</Text>
      </Box>
    )
  } else {
    // A line of fixed width, centered: the focus letter sits in its middle
    // whatever the word, so it never moves.
    const word = done ? 'Done.' : (tok?.w ?? '')
    const o = orpIndex(word)
    const left = word.slice(0, o)
    const right = word.slice(o + 1)
    const pre = ' '.repeat(Math.max(0, SIDE - left.length)) + left
    const post = right + ' '.repeat(Math.max(0, SIDE - right.length))
    const guide = ' '.repeat(SIDE) + '\u2502' + ' '.repeat(SIDE)
    stage = (
      <Box flexDirection="column" alignItems="center" paddingY={2}>
        <Text mono size="title" dimColor>{guide}</Text>
        <Text mono size="title" bold>
          {pre}
          <Text color={FOCUS}>{word.slice(o, o + 1)}</Text>
          {post}
        </Text>
        <Text mono size="title" dimColor>{guide}</Text>
      </Box>
    )
  }

  const state = done ? 'Finished' : m.playing ? 'Playing' : 'Paused'
  const icon = done ? '\u2713' : m.playing ? '\u25b6' : '\u23f8'
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Progress: one thin bar on the top row (click it to jump). */}
      <Box flexDirection="row" width="100%" height={1}>
        <Box width={`${pct}%`} height={1} backgroundColor={CLAUDE} />
        <Box flexGrow={1} height={1} backgroundColor={TRACK} />
      </Box>
      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Text>
          <Text bold color={isYou ? YOU : CLAUDE}>{isYou ? 'You' : 'Claude'}</Text>
          <Text dimColor>{`  Message ${(tok?.m ?? 0) + 1} of ${msgs.length}`}</Text>
        </Text>
        <Text dimColor tabular>{`${pct}%`}</Text>
      </Box>
      {stage}
      <Box flexDirection="row" justifyContent="center" gap={2}>
        <Text bold>{`${icon} ${state}`}</Text>
        <Text tabular>{`${m.wpm} wpm`}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column" alignItems="center">
        {modeRow}
      </Box>
      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text dimColor>{heard
          ? 'Space play \u00b7 \u2191\u2193 speed \u00b7 \u2190\u2192 sentence \u00b7 c code'
          : 'Click here, then press Space to start'}</Text>
        {p.dropped > 0 && (
          <Text dimColor>{`Oldest ${p.dropped} message${p.dropped === 1 ? '' : 's'} not included (too long)`}</Text>
        )}
      </Box>
    </Box>
  )
}

export default Reader
