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

const PIVOT = 10 // the column the focus letter always sits in
const WPM_MIN = 150
const WPM_MAX = 900
const WPM_STEP = 25
const clampWpm = (w: number) => Math.min(WPM_MAX, Math.max(WPM_MIN, Math.round(w)))
const CLAUDE = '#D97757'
const YOU = '#5B9BD5'

// One reader instance at a time: what its timer and handlers read.
let props: ReaderProps = { id: '', msgs: [], dropped: 0, wpm: 300, mode: 'latest', modeSeq: 0 }
let set: (m: Model) => void = () => {}
let barWidth = 40
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
  barWidth = Math.max(10, s.columns || 40)
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
      const { toks, starts } = data(cur.mode)
      if (toks.length === 0) return
      const at = Math.min(toks.length - 1, Math.floor((e.x / barWidth) * toks.length))
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
  const who = msg?.r === 'u' ? 'You' : 'Claude'

  // The progress bar: one cell per slice of the thread, colored by speaker.
  const cells: { ch: string; color: string }[] = []
  for (let x = 0; x < barWidth && total > 0; x++) {
    const at = Math.min(total - 1, Math.floor((x / barWidth) * total))
    const r = msgs[toks[at]?.m ?? 0]?.r
    cells.push({ ch: at < m.i ? '█' : '░', color: r === 'u' ? YOU : CLAUDE })
  }
  const runs: { ch: string; color: string; n: number }[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.ch === c.ch && last.color === c.color) last.n++
    else runs.push({ ...c, n: 1 })
  }

  const modeRow = (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      {MODES.map((mode, k) => (
        <Button
          key={`mode-${mode}`}
          label={`${k + 1} ${MODE_LABEL[mode]}${mode === m.mode ? ' *' : ''}`}
          onPress={() => {
            const cur = s.state
            if (!cur || cur.mode === mode) return
            const next = { ...cur, mode, i: 0, playing: false, showCode: false }
            set(next)
            s.post({ wpm: next.wpm, mode })
          }}
        />
      ))}
    </Box>
  )

  if (total === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Nothing to read in this view yet.</Text>
        {modeRow}
      </Box>
    )
  }

  let stage
  if (tok?.code && m.showCode && !done) {
    stage = (
      <Box flexDirection="column">
        <Code source={tok.code.source} language={tok.code.lang || undefined} />
        <Button key="code-back" label="Back to reading (c)" onPress={() => {
          const cur = s.state
          if (cur) set({ ...cur, showCode: false })
        }} />
      </Box>
    )
  } else if (tok?.code && !done) {
    stage = (
      <Box flexDirection="column" paddingY={1} gap={1}>
        <Text mono size="title" bold color={CLAUDE}>{tok.w}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="code-view" label="View code (c)" onPress={() => {
            const cur = s.state
            if (cur) set({ ...cur, playing: false, showCode: true })
          }} />
          <Text dimColor>Space skips past it</Text>
        </Box>
      </Box>
    )
  } else {
    const word = done ? 'Done.' : (tok?.w ?? '')
    const o = orpIndex(word)
    const marker = ' '.repeat(PIVOT) + '|'
    stage = (
      <Box flexDirection="column" paddingY={1}>
        <Text mono size="title" dimColor>{marker}</Text>
        <Box flexDirection="row">
          <Text mono size="title" bold>{' '.repeat(Math.max(0, PIVOT - o)) + word.slice(0, o)}</Text>
          <Text mono size="title" bold color="red">{word.slice(o, o + 1)}</Text>
          <Text mono size="title" bold>{word.slice(o + 1)}</Text>
        </Box>
        <Text mono size="title" dimColor>{marker}</Text>
      </Box>
    )
  }

  const pct = Math.round((Math.min(m.i, total) / total) * 100)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {runs.map((r, k) => (
          <Text key={`bar-${k}`} color={r.color} dimColor={r.ch === '░'}>{r.ch.repeat(r.n)}</Text>
        ))}
      </Box>
      <Text>
        <Text bold color={msg?.r === 'u' ? YOU : CLAUDE}>{who}</Text>
        <Text dimColor>{`  ·  Message ${(tok?.m ?? 0) + 1} of ${msgs.length}  ·  ${pct}%`}</Text>
      </Text>
      {stage}
      <Text bold>
        {`${m.wpm} wpm  `}
        <Text dimColor>{done ? 'Done. Space replays' : m.playing ? 'Playing' : 'Paused'}</Text>
      </Text>
      {modeRow}
      {p.dropped > 0 && <Text dimColor>{`${p.dropped} older messages left out (size limit)`}</Text>}
      <Text dimColor>Space play/pause · Up/Down speed · Left/Right sentence · 1/2/3 view · click bar to jump</Text>
      <Text dimColor>Click the panel first so keys reach it; Esc returns to the chat</Text>
    </Box>
  )
}

export default Reader
