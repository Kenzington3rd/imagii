import { describe, it, expect, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { DraftField, type DraftFieldProps } from './DraftField'

// The test environment is `node` (no DOM, no React renderer), so the hooks DraftField uses are a small stand-in: state slots that re-render synchronously, refs that persist, and
// effects that run after a render and clean up before the next run or at unmount. That is the whole of React's contract the component relies on, and it is what lets a unit test
// UNMOUNT a field with a draft pending (the T-187 (1) case: the box is gone before the browser's blur). The click on the empty canvas that does it for real is image.spec.ts.
const h = vi.hoisted(() => {
  interface Slot {
    value?: unknown
    ref?: { current: unknown }
    deps?: unknown[]
    cleanup?: (() => void) | void
  }
  interface Instance {
    slots: Slot[]
    idx: number
    effects: Array<{ slot: Slot; fn: () => (() => void) | void; deps?: unknown[] }>
    render: () => void
  }
  return { cur: null as Instance | null }
})
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>()
  type Inst = NonNullable<typeof h.cur>
  const slot = (): { inst: Inst; s: Inst['slots'][number]; first: boolean } => {
    const inst = h.cur as Inst
    const first = inst.slots[inst.idx] === undefined
    if (first) inst.slots[inst.idx] = {}
    return { inst, s: inst.slots[inst.idx++] as Inst['slots'][number], first }
  }
  return {
    ...real,
    useState: <T,>(initial: T): [T, (v: T) => void] => {
      const { inst, s, first } = slot()
      if (first) s.value = initial
      return [
        s.value as T,
        (v: T) => {
          if (Object.is(s.value, v)) return
          s.value = v
          inst.render()
        }
      ]
    },
    useRef: <T,>(initial: T): { current: T } => {
      const { s, first } = slot()
      if (first) s.ref = { current: initial }
      return s.ref as { current: T }
    },
    useId: () => ':r0:',
    useEffect: (fn: () => (() => void) | void, deps?: unknown[]): void => {
      const { inst, s } = slot()
      inst.effects.push({ slot: s, fn, deps })
    }
  }
})

type El = ReactElement<{ children?: ReactNode; [k: string]: unknown }> & { ref?: { current: unknown } | null }

function walk(node: ReactNode, visit: (el: El) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit))
  if (node === null || typeof node !== 'object' || !('props' in node)) return
  visit(node as El)
  walk((node as El).props.children, visit)
}

function mount(initial: DraftFieldProps) {
  const scrolled: Array<unknown> = []
  const fakeNode = { scrollIntoView: (arg: unknown) => void scrolled.push(arg) }
  let props = initial
  let tree: ReactNode = null
  let renders = 0
  const inst = {
    slots: [] as NonNullable<typeof h.cur>['slots'],
    idx: 0,
    effects: [] as NonNullable<typeof h.cur>['effects'],
    render(): void {
      h.cur = inst
      inst.idx = 0
      inst.effects = []
      tree = DraftField(props)
      renders++
      // The sentence's <p> gets its DOM node, as React's commit would hand it.
      walk(tree, (el) => {
        if (el.type === 'p' && el.ref) el.ref.current = fakeNode
      })
      for (const e of inst.effects) {
        const ran = e.slot.deps !== undefined
        const changed = !ran || e.deps === undefined || e.deps.length !== (e.slot.deps as unknown[]).length || e.deps.some((d, i) => !Object.is(d, (e.slot.deps as unknown[])[i]))
        if (!changed) continue
        if (typeof e.slot.cleanup === 'function') e.slot.cleanup()
        e.slot.deps = e.deps ?? []
        e.slot.cleanup = e.fn()
      }
    }
  }
  inst.render()
  const find = (type: string): El | null => {
    let found: El | null = null
    walk(tree, (el) => {
      if (el.type === type) found = el
    })
    return found
  }
  const input = (): El => find('input') as El
  return {
    scrolled,
    renders: () => renders,
    sentence: (): string | null => {
      const p = find('p')
      return p ? String(p.props.children) : null
    },
    box: (): string => String(input().props.value),
    type(text: string): void {
      ;(input().props.onChange as (e: unknown) => void)({ target: { value: text } })
    },
    blur(): void {
      ;(input().props.onBlur as () => void)()
    },
    enter(): void {
      ;(input().props.onKeyDown as (e: unknown) => void)({ key: 'Enter' })
    },
    rerender(next: Partial<DraftFieldProps>): void {
      props = { ...props, ...next }
      inst.render()
    },
    unmount(): void {
      for (const s of inst.slots) if (typeof s.cleanup === 'function') s.cleanup()
    }
  }
}

const base = (over: Partial<DraftFieldProps> = {}): DraftFieldProps => ({ value: '#ff0000', type: 'text', commit: () => null, ...over })

describe('DraftField - a box that is unmounted with a draft pending commits it, as a blur would (T-187 (1))', () => {
  it('commits the typed text once when the field unmounts before any blur (the click on the empty canvas)', () => {
    const commit = vi.fn(() => null)
    const f = mount(base({ commit }))
    f.type('#ffcc00')
    expect(commit, 'nothing is committed mid-typing').not.toHaveBeenCalled()
    f.unmount()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('#ffcc00')
  })

  it('commits what is typed LAST, not the first keystroke', () => {
    const commit = vi.fn(() => null)
    const f = mount(base({ commit }))
    f.type('#f')
    f.type('#ffcc')
    f.type('#ffcc00')
    f.unmount()
    expect(commit.mock.calls).toEqual([['#ffcc00']])
  })

  it('commits nothing when nothing was typed (a field that is only passed through)', () => {
    const commit = vi.fn(() => null)
    mount(base({ commit })).unmount()
    expect(commit).not.toHaveBeenCalled()
  })

  it('does not commit again at unmount a draft that blur already committed', () => {
    const commit = vi.fn(() => null)
    const f = mount(base({ commit }))
    f.type('#ffcc00')
    f.blur()
    expect(commit).toHaveBeenCalledTimes(1)
    f.unmount()
    expect(commit, 'blur committed it; unmount adds no second commit (a second store write, a second Undo step on a store that does not compare)').toHaveBeenCalledTimes(1)
  })

  it('does not commit again at unmount a draft that Enter already committed', () => {
    const commit = vi.fn(() => null)
    const f = mount(base({ commit }))
    f.type('#ffcc00')
    f.enter()
    f.unmount()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('does not commit again at unmount text a `live` commit already stored, and the box that was never left is not committed a second time', () => {
    const commit = vi.fn(() => null)
    const f = mount(base({ type: 'number', commit, live: () => true }))
    f.type('42')
    expect(commit.mock.calls, 'the live commit stored it as it was typed').toEqual([['42']])
    f.unmount()
    expect(commit, 'unmount stores nothing more').toHaveBeenCalledTimes(1)
  })

  it('commits at unmount what was typed AFTER the last live commit (a number that stopped being usable)', () => {
    const commit = vi.fn(() => null)
    const f = mount(base({ type: 'number', commit, live: (t) => t === '42' }))
    f.type('42')
    f.type('420')
    f.unmount()
    expect(commit.mock.calls, 'the live 42, then the unmount commit of the 420 the live gate did not take').toEqual([['42'], ['420']])
  })

  it('commits through the LATEST commit prop, not the one the first render had (a layer selected since)', () => {
    const first = vi.fn(() => null)
    const second = vi.fn(() => null)
    const f = mount(base({ commit: first }))
    f.type('red')
    f.rerender({ commit: second })
    f.unmount()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('red')
  })

  it('a refusal at unmount stores nothing and says nothing: no state is set once the box is gone', () => {
    const commit = vi.fn(() => 'imagii does not know that color')
    const f = mount(base({ commit }))
    f.type('zzz')
    const rendersBefore = f.renders()
    f.unmount()
    expect(commit).toHaveBeenCalledWith('zzz')
    expect(f.renders(), 'the refusal did not re-render the unmounted field').toBe(rendersBefore)
    expect(f.scrolled).toEqual([])
  })

  it('blur and Enter still commit as before: a refusal is shown and the draft stays for the person to fix', () => {
    const f = mount(base({ commit: () => 'no' }))
    f.type('zzz')
    f.blur()
    expect(f.sentence()).toBe('no')
    expect(f.box()).toBe('zzz')
  })
})

describe('DraftField - a refusal that appears is scrolled into view, nearest (T-187 (2))', () => {
  it('scrolls the sentence into view with block "nearest" when a refusal appears, once', () => {
    const f = mount(base({ commit: () => 'no' }))
    expect(f.scrolled, 'no refusal, no scroll').toEqual([])
    f.type('zzz')
    expect(f.scrolled, 'typing is not a refusal').toEqual([])
    f.enter()
    expect(f.sentence()).toBe('no')
    expect(f.scrolled).toEqual([{ block: 'nearest' }])
    f.rerender({ value: '#00ff00' })
    expect(f.scrolled.length, 'a re-render with the same sentence does not scroll again').toBe(1)
  })

  it('a refusal typed away and met again scrolls again; a commit that is accepted never scrolls', () => {
    const f = mount(base({ commit: (t) => (t === 'ok' ? null : 'no') }))
    f.type('zzz')
    f.blur()
    f.type('ok')
    expect(f.sentence(), 'typing clears the sentence').toBeNull()
    f.blur()
    expect(f.scrolled.length).toBe(1)
    f.type('zzz')
    f.blur()
    expect(f.scrolled.length).toBe(2)
  })
})
