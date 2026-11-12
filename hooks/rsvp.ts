// Pure helpers shared by the hooks module and the Client module.

export type Role = 'u' | 'a'
/** One message as the pane hands it to the reader. */
export type Msg = { r: Role; t: string }
export type Mode = 'latest' | 'claude' | 'all'
export const MODES: Mode[] = ['latest', 'claude', 'all']
export const MODE_LABEL: Record<Mode, string> = {
  latest: 'Latest reply',
  claude: "Claude's replies",
  all: 'Whole thread',
}

export type Code = { lines: number; source: string; lang: string }
export type Tok = {
  /** The word drawn; for a code block, its placeholder. */
  w: string
  /** Index into the filtered message list. */
  m: number
  sentEnd: boolean
  msgEnd: boolean
  code?: Code
}

/** Index of the Optimal Recognition Point (focus letter) in a word. */
export function orpIndex(word: string): number {
  const n = word.length
  if (n <= 1) return 0
  if (n <= 5) return 1
  if (n <= 9) return 2
  if (n <= 13) return 3
  return 4
}

export function words(text: string): string[] {
  return text.split(/\s+/).filter(w => w.length > 0)
}

/** Drops the engine's own injected blocks from a message's text. */
export function cleanText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<(command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g, '')
    .trim()
}

export function pickMessages(all: Msg[], mode: Mode): Msg[] {
  if (mode === 'all') return all
  const claude = all.filter(m => m.r === 'a')
  if (mode === 'claude') return claude
  const last = claude.at(-1)
  return last ? [last] : []
}

const MARKUP_ONLY = /^([-*+>#|]+|\d+\.|-{3,}|={3,})$/

/** A word as read: markdown emphasis and inline code ticks removed. */
function cleanWord(w: string): string {
  return w.replace(/\*\*|__|`/g, '').replace(/^[*_]+|[*_]+$/g, '')
}

function proseTokens(text: string, m: number, out: Tok[]) {
  const prose = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [label](url) -> label
  for (const line of prose.split('\n')) {
    const before = out.length
    for (const raw of words(line)) {
      if (MARKUP_ONLY.test(raw)) continue
      const w = cleanWord(raw)
      if (w === '') continue
      out.push({ w, m, sentEnd: /[.!?]["')\]]*$/.test(w), msgEnd: false })
    }
    // A line break ends a sentence too (headings, list items).
    const last = out[out.length - 1]
    if (out.length > before && last) last.sentEnd = true
  }
}

/** Turns messages into the tokens the reader flashes, each code block one token. */
export function tokenize(msgs: Msg[]): Tok[] {
  const out: Tok[] = []
  msgs.forEach((msg, m) => {
    const fence = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g
    let at = 0
    for (let f = fence.exec(msg.t); f; f = fence.exec(msg.t)) {
      proseTokens(msg.t.slice(at, f.index), m, out)
      const source = (f[2] ?? '').replace(/\n$/, '')
      const lines = source === '' ? 0 : source.split('\n').length
      out.push({
        w: `[code block, ${lines} line${lines === 1 ? '' : 's'}]`,
        m,
        sentEnd: true,
        msgEnd: false,
        code: { lines, source, lang: (f[1] ?? '').trim() },
      })
      at = f.index + f[0].length
    }
    proseTokens(msg.t.slice(at), m, out)
    const last = out[out.length - 1]
    if (last && last.m === m) last.msgEnd = true
  })
  return out
}

/** How long a token stays on screen, in ms. */
export function delayMs(tok: Tok, wpm: number): number {
  const base = 60000 / wpm
  let mult = 1
  const letters = tok.w.replace(/[^\p{L}\p{N}]/gu, '').length
  if (letters > 6) mult += Math.min(0.6, (letters - 6) * 0.08)
  if (/[,;:–—]["')\]]*$/.test(tok.w)) mult += 0.5
  if (tok.sentEnd) mult += 1
  const between = tok.msgEnd ? Math.max(700, 3 * base) : 0
  return Math.round(base * mult + between)
}

/** Indices where a sentence (or a code block, or a message) starts. */
export function sentenceStarts(toks: Tok[]): number[] {
  const starts: number[] = []
  toks.forEach((t, i) => {
    const prev = toks[i - 1]
    if (!prev || prev.sentEnd || prev.msgEnd || prev.code || t.code) starts.push(i)
  })
  return starts
}

export function startOf(starts: number[], i: number): number {
  let s = 0
  for (const x of starts) if (x <= i) s = x
  return s
}

/** Back to this sentence's start, or the one before when already there. */
export function prevSentence(starts: number[], i: number): number {
  const here = startOf(starts, i)
  if (i - here >= 2) return here
  let prev = 0
  for (const x of starts) if (x < here) prev = x
  return prev
}

export function nextSentence(starts: number[], i: number, total: number): number {
  for (const x of starts) if (x > i) return x
  return total
}
