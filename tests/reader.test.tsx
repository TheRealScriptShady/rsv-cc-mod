import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMessage } from 'claude-code'
import { delayMs, tokenize } from '../hooks/rsvp'

const PANE = {
  plugin: 'rsvp-reader',
  component: 'Pane',
  requestId: 'rsvp',
  props: {
    title: 'RSVP reader',
    isFocused: true,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const THREAD: SessionMessage[] = [
  { role: 'user', text: 'Explain please.', toolUses: [] },
  { role: 'assistant', text: 'First sentence here. Second one now.', toolUses: [] },
  { role: 'user', text: 'And code?', toolUses: [] },
  {
    role: 'assistant',
    text: 'Look below.\n```ts\nconst a = 1\nconst b = 2\nlog(a + b)\n```\nThat is all.',
    toolUses: [],
  },
]

const seed = (on: On, msgs: SessionMessage[] = THREAD) => {
  mock.store(on)
  on('session.messages', () => ({ value: msgs }))
}

const SURFACES = ['terminal', 'desktop'] as const

async function mount($: any, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ ...PANE, surface })
  const find = (text: RegExp) => ui.find({ type: 'Text', text, in: 'reader' })
  /** The word on stage, rebuilt from its three parts. */
  const word = async () => {
    const tree: any = await ui.drawn({ in: 'reader' })
    const flat: any[] = []
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return
      flat.push(n)
      for (const c of n.children ?? []) walk(c)
    }
    walk(tree)
    const line = flat.find(
      n => n.type === 'Text' && n.props?.mono && n.props?.bold && (n.children ?? []).some((c: any) => c?.props?.color),
    )
    const text = (n: any): string => (typeof n === 'string' ? n : (n?.children ?? []).map(text).join(''))
    return line ? text(line).trim() : undefined
  }
  return { ui, find, word }
}

test('tokens: markdown stripped, code blocks are one token, sentences and messages marked', () => {
  const toks = tokenize([
    { r: 'a', t: '## Title\n- **Bold** item, [link](http://x).\n```js\nx()\ny()\n```\nEnd.' },
  ])
  expect(toks.map(t => t.w)).toEqual(['Title', 'Bold', 'item,', 'link.', '[code block, 2 lines]', 'End.'])
  expect(toks[0]?.sentEnd).toBe(true) // heading line
  expect(toks[4]?.code?.source).toBe('x()\ny()')
  expect(toks[5]?.msgEnd).toBe(true)
})

test('timing: long words, commas, sentence ends and message ends take longer', () => {
  const t = (w: string, extra: object = {}) => delayMs({ w, m: 0, sentEnd: false, msgEnd: false, ...extra }, 300)
  expect(t('cat')).toBe(200)
  expect(t('extraordinary')).toBeGreaterThan(200)
  expect(t('cat,')).toBe(300)
  expect(t('cat.', { sentEnd: true })).toBe(400)
  expect(t('cat.', { sentEnd: true, msgEnd: true })).toBe(1100)
})

test('starts paused, Space plays, header shows speaker and message count', async ($, on) => {
  seed(on)
  for (const surface of SURFACES) {
    const { ui, find, word } = await mount($, surface)
    expect(await word()).toBe('Look') // latest reply by default
    expect(await find(/Paused/)).toBeDefined()
    expect((await find(/Message/))?.text).toMatch(/Message 1 of 1/)
    await ui.advance(1000)
    expect(await word()).toBe('Look')
    await ui.key({ key: ' ' })
    await ui.advance(200)
    expect(await word()).toBe('below.')
    await ui.unmount()
  }
})

test('a code block pauses, shows its size, c views it, Space moves past', async ($, on) => {
  seed(on)
  for (const surface of SURFACES) {
    const { ui, find, word } = await mount($, surface)
    await ui.key({ key: ' ' })
    await ui.advance(200 + 400) // "Look" then "below." (sentence end)
    expect(await find(/\[code block, 3 lines\]/)).toBeDefined()
    expect(await find(/Paused/)).toBeDefined()
    await ui.advance(5000)
    expect(await find(/\[code block, 3 lines\]/)).toBeDefined() // still waiting
    await ui.key({ key: 'c' })
    expect(await ui.find({ type: 'Code', in: 'reader' })).toBeDefined()
    await ui.key({ key: 'c' })
    expect(await ui.find({ type: 'Code', in: 'reader' })).toBeUndefined()
    await ui.key({ key: ' ' })
    expect(await word()).toBe('That')
    expect(await find(/Playing/)).toBeDefined()
    await ui.unmount()
  }
})

test('views: 2 is Claude only, 3 the whole thread with You/Claude labels', async ($, on) => {
  seed(on)
  for (const surface of SURFACES) {
    const { ui, find, word } = await mount($, surface)
    await ui.key({ key: '2' })
    expect(await word()).toBe('First')
    expect((await find(/Message/))?.text).toMatch(/Message 1 of 2/)
    await ui.key({ key: '3' })
    expect(await word()).toBe('Explain')
    expect(await find(/^You$/)).toBeDefined()
    expect((await find(/Message/))?.text).toMatch(/Message 1 of 4/)
    await ui.key({ key: 'right' }) // next sentence = next message
    expect(await word()).toBe('First')
    expect(await find(/^Claude$/)).toBeDefined()
    await ui.unmount()
  }
})

test('Left/Right jump by sentence', async ($, on) => {
  seed(on)
  for (const surface of SURFACES) {
    const { ui, word } = await mount($, surface)
    await ui.key({ key: '2' })
    await ui.key({ key: 'right' })
    expect(await word()).toBe('Second')
    await ui.key({ key: 'right' })
    expect(await word()).toBe('Look') // next message
    await ui.key({ key: 'left' })
    expect(await word()).toBe('Second')
    await ui.key({ key: 'left' })
    expect(await word()).toBe('First')
    await ui.unmount()
  }
})

test('a longer pause between messages', async ($, on) => {
  seed(on)
  const { ui, word } = await mount($, 'desktop')
  await ui.key({ key: '2' })
  await ui.key({ key: 'right' }) // "Second one now." ends message 1
  await ui.key({ key: ' ' })
  await ui.advance(200 + 200) // Second, one
  expect(await word()).toBe('now.')
  await ui.advance(400) // a sentence end alone would be done by now
  expect(await word()).toBe('now.')
  await ui.advance(700)
  expect(await word()).toBe('Look')
  await ui.unmount()
})

test('clicking the progress bar jumps there', async ($, on) => {
  seed(on)
  for (const surface of SURFACES) {
    const { ui, word } = await mount($, surface)
    await ui.key({ key: '3' })
    await ui.resize({ columns: 40, rows: 20 })
    await ui.pointer({ type: 'down', x: 39, y: 0, button: 'left' })
    expect(await word()).toBe('That') // start of the last sentence
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left' })
    expect(await word()).toBe('Explain')
    await ui.unmount()
  }
})

test('speed and view are saved, and come back', async ($, on) => {
  seed(on)
  const ui = (await mount($, 'desktop')).ui
  await ui.key({ key: 'up' })
  await ui.key({ key: '3' })
  await ui.unmount()
  const again = await mount($, 'terminal')
  expect((await again.find(/wpm/))?.text).toMatch(/^325 wpm/)
  expect(await again.word()).toBe('Explain')
  await again.ui.unmount()
})

test('/rsvp all opens the whole thread', async ($, on) => {
  seed(on)
  on('command.register', () => ({ value: { command: 'rsvp' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const { ui, word } = await mount($, 'desktop')
  expect(await word()).toBe('Look')
  const out = await $.command.run({
    command: 'rsvp',
    args: 'all',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 100 },
  })
  expect(JSON.stringify(out)).toMatch(/Whole thread/)
  expect(await word()).toBe('Explain')
  await ui.unmount()
})

test('mobile explains the reader needs desktop or terminal', async ($, on) => {
  seed(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Text', text: /desktop app/ })).toBeDefined()
  await ui.unmount()
})
