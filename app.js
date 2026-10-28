// The whole app: three tabs (History, Log, Backup) rendered from one state
// object. No framework and no build step, so it can be hosted anywhere that
// serves files.
//
// Typing never re-renders. Rebuilding the page on every keystroke would take
// focus out of the box and drop the iPhone keyboard mid-set, so input events
// only update state (and the odd label in place). Taps re-render.

import * as store from './store.js'

/* ------------------------------------------------------------------- dates */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayKey = () => dayKey(new Date())
// Noon avoids the date shifting under any timezone arithmetic.
const parseKey = (key) => new Date(key + 'T12:00:00')

/** "Today", "Yesterday", "Tue 26 Aug", or "26 Aug". Never a bare ISO string. */
function friendlyDay(key) {
  if (!key) return '—'
  const d = parseKey(key)
  const diff = Math.round((parseKey(todayKey()) - d) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  if (diff > 0 && diff < 7) return `${WEEKDAYS[d.getDay()]} ${base}`
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`
}

/* ------------------------------------------------------------------ helpers */

const h = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const num = (n) => Math.round(n).toLocaleString()
const setText = (s) => (s.weight ? `${s.weight} × ${s.reps}` : `${s.reps} reps`)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const svg = (paths, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const I = {
  chevron: (s) => svg('<path d="m5 9 7 7 7-7"/>', s),
  x: (s) => svg('<path d="M6 6l12 12M18 6 6 18"/>', s),
  plus: (s) => svg('<path d="M12 5v14M5 12h14"/>', s),
  trash: (s) => svg('<path d="M4 7h16M9 7V5h6v2M6.5 7l.8 12.1a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L17.5 7"/>', s),
  flag: (s) => svg('<path d="M6 21V4M6 5h11l-2 3.5L17 12H6"/>', s),
  up: (s) => svg('<path d="M12 19V5M6 11l6-6 6 6"/>', s),
  down: (s) => svg('<path d="M12 5v14M6 13l6 6 6-6"/>', s),
}

function delta(value) {
  if (value == null) return ''
  const flat = Math.abs(value) < 0.5
  const up = value > 0
  const cls = flat ? 'faint' : up ? 'good' : 'bad'
  return `<span class="delta ${cls}">${flat ? '' : up ? I.up(12) : I.down(12)}${up ? '+' : ''}${value.toFixed(1)}%</span>`
}

/* -------------------------------------------------------------------- state */

const DRAFT_KEY = 'lift.draft'

// A fresh, empty sheet. Spread over whatever was restored so a draft written
// by an older version cannot arrive missing a field.
const emptyDraft = () => ({ id: null, date: todayKey(), type: null, newType: '', blocks: [], notes: '' })

function loadDraft() {
  try {
    return { ...emptyDraft(), ...JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') }
  } catch {
    return emptyDraft()
  }
}

// Written on every change, synchronously. iOS can freeze a backgrounded app
// before any deferred save runs, and a half-logged session is exactly what
// gets lost that way.
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state.draft))
  } catch {
    /* out of quota or blocked — losing a draft is not worth an error */
  }
}

const hasDraft = (d) => !!d.type || d.blocks.some((b) => b.name || b.sets.length)

const state = {
  all: store.load(),
  draft: loadDraft(),
  tab: 'history',
  open: null, // the expanded workout in History
  confirm: null, // the workout waiting on "Delete for good"
}
// Coming back to a half-logged workout should land on it.
state.tab = hasDraft(state.draft) ? 'log' : 'history'

function commit(list) {
  state.all = list
  if (!store.persist(list)) toast('Could not save — the phone is out of storage for this app')
}

/* ----------------------------------------------------------------- history */

function workoutRow(w) {
  const cmp = store.compare(state.all, w)
  const open = state.open === w.id
  let body = ''

  if (open) {
    const against = cmp.previous
      ? `<p class="body mute mb">Against your last ${h(w.type)} on <span style="color:var(--bone)">${friendlyDay(cmp.previous.date)}</span>:
          volume <span class="tnum" style="color:var(--bone)">${num(cmp.volume)}</span> against
          <span class="tnum">${num(cmp.prevVolume)}</span>, a change of
          <span class="${cmp.deltaPct >= 0 ? 'good' : 'bad'}">${cmp.deltaPct >= 0 ? '+' : ''}${cmp.deltaPct.toFixed(1)}%</span>.</p>`
      : `<p class="body faint mb">First ${h(w.type)} on record — nothing to compare against yet.</p>`

    const exercises = w.exercises
      .map((ex) => {
        const c = cmp.exercises?.find((e) => e.name === ex.name)
        const vol = c?.volume ?? store.exerciseVolume(ex)
        const volDelta = c?.prevVolume ? ((c.volume - c.prevVolume) / c.prevVolume) * 100 : null
        return `<div class="card">
          <div class="row wrap">
            <span style="font-size:14px">${h(ex.name)}</span>
            ${c?.isNew ? '<span class="chip good">new this time</span>' : ''}
            ${c?.record ? `<span class="chip warn">${I.flag(11)} all-time best</span>` : ''}
            <span class="right row small faint tnum">${num(vol)} lb ${delta(volDelta)}</span>
          </div>
          <div class="chips mt-s">${ex.sets.map((s) => `<span class="set">${setText(s)}</span>`).join('')}</div>
          ${
            c?.prevBest && c?.best
              ? `<p class="small faint tnum mt-s">best set ${c.best.weight} × ${c.best.reps} · last time ${c.prevBest.weight} × ${c.prevBest.reps}</p>`
              : ''
          }
        </div>`
      })
      .join('')

    const actions =
      state.confirm === w.id
        ? `<button class="btn sm danger" data-action="del-yes" data-id="${h(w.id)}">Delete for good</button>
           <button class="btn sm quiet" data-action="del-no">Cancel</button>`
        : `<button class="btn sm" data-action="edit" data-id="${h(w.id)}">Edit</button>
           <button class="btn sm quiet bad" data-action="del-ask" data-id="${h(w.id)}">${I.trash(14)} Delete</button>`

    body = `<div class="wo-body">
      ${against}
      <div class="stack">${exercises}</div>
      ${w.notes ? `<p class="body mute mt">${h(w.notes)}</p>` : ''}
      <div class="row wrap mt">${actions}</div>
    </div>`
  }

  return `<div class="wo ${open ? 'open' : ''}">
    <button class="wo-head" data-action="toggle" data-id="${h(w.id)}">
      <span class="chev">${I.chevron(16)}</span>
      <span class="grow">
        <span class="wo-title">${h(w.type)}</span>
        <span class="wo-sub tnum">${friendlyDay(w.date)} · ${plural(w.exercises.length, 'exercise')}</span>
      </span>
      <span style="text-align:right;flex-shrink:0">
        <span class="tnum" style="display:block;font-size:14px">${num(cmp.volume)} lb</span>
        ${cmp.previous ? delta(cmp.deltaPct) : ''}
      </span>
    </button>
    ${body}
  </div>`
}

function historyView() {
  const resume = hasDraft(state.draft)
  return `<div class="mb">
      <button class="btn solid lg full" data-action="tab" data-tab="log">
        ${resume ? 'Continue workout' : `${I.plus(16)} Log a workout`}
      </button>
    </div>
    <div class="section-title"><h2>History</h2><span class="right small faint">${plural(state.all.length, 'session')}</span></div>
    ${
      state.all.length
        ? `<div class="panel">${state.all.map(workoutRow).join('')}</div>`
        : `<div class="empty">No workouts logged yet. Bringing them over from Headquarters? That's on the Backup tab.</div>`
    }`
}

/* ------------------------------------------------------------------ logger */

const sugg = () => store.suggestions(state.all)

function priorHint(prior) {
  if (!prior) return ''
  const last = prior.last.sets.map(setText).join('  ·  ')
  // Only say where the pre-filled number came from when it is not simply the
  // best of last time — otherwise it restates the line above.
  const from =
    prior.from !== prior.last.date
      ? `<p><span class="mute">Starting from</span> <span class="tnum" style="color:var(--bone)">${prior.weight}×${prior.reps}</span> — your heaviest in the last ${prior.sessionsConsidered} (${friendlyDay(prior.from)})</p>`
      : ''
  return `<p><span class="mute">Last time</span> · ${friendlyDay(prior.last.date)}: <span class="tnum" style="color:var(--bone)">${h(last)}</span></p>${from}`
}

function blockView(b, i, prefill, unused) {
  const prior = prefill[b.name] || null
  const weight = b.draftWeight ?? (prior ? String(prior.weight) : '')
  return `<div class="card" data-block="${i}">
    <div class="row">
      <input class="field grow" list="ex-list" data-field="ex-name" data-i="${i}" value="${h(b.name)}"
        placeholder="Exercise" autocapitalize="words" autocomplete="off" />
      <button class="icon-btn" data-action="remove-block" data-i="${i}" aria-label="Remove exercise">${I.x(15)}</button>
    </div>
    <div class="chips mt-s" data-chips="${i}" ${b.name || !unused.length ? 'hidden' : ''}>
      ${unused.map((n) => `<button class="chip" data-action="pick-ex" data-i="${i}" data-name="${h(n)}">${h(n)}</button>`).join('')}
    </div>
    <div class="row mt">
      <input class="field num" type="number" inputmode="decimal" data-field="weight" data-i="${i}" value="${h(weight)}" placeholder="lb" aria-label="Weight" />
      <span class="faint">×</span>
      <input class="field num" type="number" inputmode="numeric" data-field="reps" data-i="${i}" value="${h(b.draftReps ?? '')}" placeholder="reps" aria-label="Reps" enterkeyhint="done" />
      <button class="btn solid right" data-action="add-set" data-i="${i}" ${b.draftReps ? '' : 'disabled'}>Add set</button>
    </div>
    <div class="small faint mt-s stack" style="gap:2px;line-height:1.5" data-hint="${i}">${priorHint(prior)}</div>
    ${
      b.sets.length
        ? `<div class="chips mt">${b.sets
            .map(
              (s, j) =>
                `<button class="set" data-action="remove-set" data-i="${i}" data-s="${j}" aria-label="Remove set ${setText(s)}">${setText(s)} ${I.x(12)}</button>`,
            )
            .join('')}</div>`
        : ''
    }
  </div>`
}

function logView() {
  const d = state.draft
  const s = sugg()
  const editing = d.id ? state.all.find((w) => w.id === d.id) : null

  let typePart
  if (d.type) {
    typePart = `<div class="row wrap">
        <span class="chip solid">${h(d.type)}</span>
        <button class="btn sm quiet right" data-action="clear-type">Change</button>
      </div>`
  } else {
    typePart = `<div class="chips">
        ${s.types.map((t) => `<button class="chip" data-action="pick-type" data-type="${h(t)}">${h(t)}</button>`).join('')}
        ${s.types.length ? '' : '<span class="body faint">No past types yet — name one below.</span>'}
      </div>
      <div class="row mt-s">
        <input class="field grow" data-field="newType" value="${h(d.newType)}" placeholder="${s.types.length ? 'or a new type' : 'e.g. Push Day'}" autocapitalize="words" enterkeyhint="go" />
        <button class="btn" data-action="use-type" ${d.newType.trim() ? '' : 'disabled'}>Use it</button>
      </div>`
  }

  let rest = ''
  if (d.type) {
    const typeExercises = s.byType[d.type] || []
    const used = new Set(d.blocks.map((b) => b.name))
    const unused = typeExercises.filter((e) => !used.has(e))
    const prefill = s.prefill[d.type] || {}
    const total = d.blocks.reduce((a, b) => a + store.exerciseVolume(b), 0)
    const ready = d.blocks.some((b) => b.name.trim() && b.sets.length)

    rest = `<div class="stack mt">${d.blocks.map((b, i) => blockView(b, i, prefill, unused)).join('')}</div>
      <button class="btn full mt-s" data-action="add-block">${I.plus(16)} Add exercise</button>
      <textarea class="field mt" rows="2" data-field="notes" placeholder="Notes (optional)">${h(d.notes)}</textarea>
      <div class="divider"></div>
      <div class="row">
        <span class="body mute">${plural(d.blocks.length, 'exercise')} · <span class="tnum" style="color:var(--bone)">${num(total)} lb</span></span>
        <button class="btn solid right" data-action="save" ${ready ? '' : 'disabled'}>${editing ? 'Save changes' : 'Save workout'}</button>
      </div>
      <datalist id="ex-list">${typeExercises.map((e) => `<option value="${h(e)}"></option>`).join('')}</datalist>`
  }

  const banner = editing
    ? `<div class="row mb body mute">Editing ${h(editing.type)} from ${friendlyDay(editing.date)}
        <button class="btn sm quiet right" data-action="discard">Stop editing</button></div>`
    : hasDraft(d)
      ? `<div class="row mb"><button class="btn sm quiet right" data-action="discard">Discard this workout</button></div>`
      : ''

  return `${banner}<div class="panel pad">
    <div class="row wrap">
      <span class="label">Date</span>
      <input class="field" type="date" data-field="date" value="${h(d.date)}" max="${todayKey()}" />
    </div>
    <div class="mt"><p class="label" style="margin-bottom:8px">Workout type</p>${typePart}</div>
    ${rest}
  </div>`
}

/* ------------------------------------------------------------------ backup */

function backupView() {
  return `<div class="panel pad stack" style="gap:14px">
    <p class="body">Your workouts live only on this phone — <span class="tnum">${plural(state.all.length, 'session')}</span> right now.
      Export a backup now and then and keep it in Files or iCloud Drive.</p>
    <div class="row wrap">
      <button class="btn solid" data-action="export" ${state.all.length ? '' : 'disabled'}>Export backup</button>
      <button class="btn" data-action="import">Import a file</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden />
    </div>
    <div class="divider" style="margin:0"></div>
    <p class="small faint" style="line-height:1.6">Importing merges: a workout already here is replaced by the one in the file, so importing the same backup twice changes nothing.
      Headquarters history works too — open <span class="mute">/api/workouts?limit=500</span> on Headquarters while signed in, save that page as a file, and import it here.</p>
  </div>`
}

/* ------------------------------------------------------------------ render */

const app = document.getElementById('app')

function render() {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === state.tab)
  app.innerHTML = state.tab === 'log' ? logView() : state.tab === 'backup' ? backupView() : historyView()
}

let toastTimer
function toast(msg) {
  document.querySelector('.toast')?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = msg
  document.body.append(el)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.remove(), 3200)
}

const focusField = (field, i) => app.querySelector(`[data-field="${field}"][data-i="${i}"]`)?.focus()

/* ----------------------------------------------------------------- actions */

function patchDraft(fields) {
  state.draft = { ...state.draft, ...fields }
  saveDraft()
}

function setBlock(i, next) {
  patchDraft({ blocks: state.draft.blocks.map((b, j) => (j === i ? next : b)) })
}

function addSet(i) {
  const b = state.draft.blocks[i]
  const reps = parseInt(b.draftReps, 10)
  if (!reps) return
  const prior = (sugg().prefill[state.draft.type] || {})[b.name]
  const raw = b.draftWeight ?? (prior ? String(prior.weight) : '')
  const weight = raw === '' ? 0 : Number(raw) || 0
  setBlock(i, {
    ...b,
    sets: [...b.sets, { weight, reps }],
    draftReps: '',
    // The next set starts from what this one actually was, still editable.
    draftWeight: weight ? String(weight) : '',
  })
  render()
  focusField('reps', i)
}

function save() {
  try {
    const d = state.draft
    const { list } = store.saveWorkout(
      state.all,
      {
        id: d.id,
        date: d.date,
        type: d.type,
        notes: d.notes,
        exercises: d.blocks.map(({ name, sets }) => ({ name, sets })),
      },
      todayKey(),
    )
    commit(list)
    toast(d.id ? 'Changes saved' : 'Workout saved')
    state.draft = emptyDraft()
    saveDraft()
    state.tab = 'history'
    state.open = null
    render()
    window.scrollTo(0, 0)
  } catch (e) {
    toast(e.message)
  }
}

async function exportBackup() {
  const json = JSON.stringify(store.exportData(state.all), null, 2)
  const name = `workouts-${todayKey()}.json`
  const file = new File([json], name, { type: 'application/json' })
  // The share sheet is the reliable route on an iPhone ("Save to Files");
  // a plain download is the fallback everywhere else.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (e) {
      if (e.name === 'AbortError') return
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text())
    const r = store.importData(state.all, data, todayKey())
    commit(r.list)
    toast(
      `Imported: ${r.added} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (no date or no sets)` : ''}`,
    )
    render()
  } catch (e) {
    toast(e instanceof SyntaxError ? 'That file is not a workouts backup' : e.message)
  }
}

const actions = {
  tab: (el) => {
    state.tab = el.dataset.tab
    state.confirm = null
    render()
    window.scrollTo(0, 0)
  },
  toggle: (el) => {
    state.open = state.open === el.dataset.id ? null : el.dataset.id
    state.confirm = null
    render()
  },
  'del-ask': (el) => {
    state.confirm = el.dataset.id
    render()
  },
  'del-no': () => {
    state.confirm = null
    render()
  },
  'del-yes': (el) => {
    commit(store.deleteWorkout(state.all, el.dataset.id))
    state.confirm = null
    state.open = null
    render()
    toast('Workout deleted')
  },
  edit: (el) => {
    if (hasDraft(state.draft) && state.draft.id !== el.dataset.id) {
      if (!confirm('You have an unsaved workout. Replace it with this one?')) return
    }
    const w = state.all.find((x) => x.id === el.dataset.id)
    state.draft = {
      ...emptyDraft(),
      id: w.id,
      date: w.date,
      type: w.type,
      notes: w.notes || '',
      blocks: w.exercises.map((ex) => ({ name: ex.name, sets: ex.sets.map((s) => ({ ...s })), draftWeight: null, draftReps: '' })),
    }
    saveDraft()
    state.tab = 'log'
    render()
    window.scrollTo(0, 0)
  },
  discard: () => {
    if (!state.draft.id && !confirm('Throw away this workout?')) return
    const wasEditing = !!state.draft.id
    state.draft = emptyDraft()
    saveDraft()
    if (wasEditing) state.tab = 'history'
    render()
  },
  'pick-type': (el) => {
    patchDraft({ type: el.dataset.type, newType: '' })
    if (!state.draft.blocks.length) patchDraft({ blocks: [{ name: '', sets: [], draftWeight: null, draftReps: '' }] })
    render()
    // Straight into the first exercise when the sheet is fresh — unless this
    // type has history, when the next tap is one of the suggestion chips and
    // an open keyboard would only cover them.
    const blank = state.draft.blocks.findIndex((b) => !b.name)
    const known = sugg().byType[state.draft.type]?.length
    if (blank >= 0 && !known && !state.draft.blocks.some((b) => b.sets.length)) focusField('ex-name', blank)
  },
  'use-type': () => {
    const t = state.draft.newType.trim()
    if (!t) return
    actions['pick-type']({ dataset: { type: t } })
  },
  'clear-type': () => {
    patchDraft({ type: null })
    render()
  },
  'add-block': () => {
    patchDraft({ blocks: [...state.draft.blocks, { name: '', sets: [], draftWeight: null, draftReps: '' }] })
    render()
    focusField('ex-name', state.draft.blocks.length - 1)
  },
  'remove-block': (el) => {
    const i = Number(el.dataset.i)
    const b = state.draft.blocks[i]
    if (b.sets.length && !confirm(`Remove ${b.name || 'this exercise'} and its ${plural(b.sets.length, 'set')}?`)) return
    patchDraft({ blocks: state.draft.blocks.filter((_, j) => j !== i) })
    render()
  },
  'pick-ex': (el) => {
    const i = Number(el.dataset.i)
    setBlock(i, { ...state.draft.blocks[i], name: el.dataset.name, draftWeight: null })
    render()
    focusField('reps', i)
  },
  'add-set': (el) => addSet(Number(el.dataset.i)),
  'remove-set': (el) => {
    const i = Number(el.dataset.i)
    const s = Number(el.dataset.s)
    const b = state.draft.blocks[i]
    setBlock(i, { ...b, sets: b.sets.filter((_, j) => j !== s) })
    render()
  },
  save,
  export: exportBackup,
  import: () => document.getElementById('import-file').click(),
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]')
  if (!el || el.disabled) return
  actions[el.dataset.action]?.(el)
})

// Typing: update state, never re-render — see the note at the top.
app.addEventListener('input', (e) => {
  const el = e.target
  const field = el.dataset.field
  if (!field) return
  const i = Number(el.dataset.i)

  if (field === 'date') patchDraft({ date: el.value || todayKey() })
  else if (field === 'notes') patchDraft({ notes: el.value })
  else if (field === 'newType') {
    patchDraft({ newType: el.value })
    app.querySelector('[data-action="use-type"]').disabled = !el.value.trim()
  } else if (field === 'weight') setBlock(i, { ...state.draft.blocks[i], draftWeight: el.value })
  else if (field === 'reps') {
    setBlock(i, { ...state.draft.blocks[i], draftReps: el.value })
    app.querySelector(`[data-action="add-set"][data-i="${i}"]`).disabled = !el.value
  } else if (field === 'ex-name') {
    setBlock(i, { ...state.draft.blocks[i], name: el.value })
    const prior = (sugg().prefill[state.draft.type] || {})[el.value] || null
    app.querySelector(`[data-hint="${i}"]`).innerHTML = priorHint(prior)
    const chips = app.querySelector(`[data-chips="${i}"]`)
    chips.hidden = !!el.value || !chips.children.length
    // A weight typed by hand is kept; one that only came from history follows
    // the name, so it is swapped for the new exercise's.
    if (state.draft.blocks[i].draftWeight == null) {
      app.querySelector(`[data-field="weight"][data-i="${i}"]`).value = prior ? prior.weight : ''
    }
  }
})

app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  const field = e.target.dataset?.field
  if (field === 'reps') {
    e.preventDefault()
    addSet(Number(e.target.dataset.i))
  } else if (field === 'newType') {
    e.preventDefault()
    actions['use-type']()
  } else if (field === 'ex-name') {
    e.preventDefault()
    focusField('weight', Number(e.target.dataset.i))
  }
})

app.addEventListener('change', (e) => {
  if (e.target.id === 'import-file' && e.target.files[0]) importFile(e.target.files[0])
})

/* -------------------------------------------------------------------- boot */

render()

// Ask the browser not to clear this app's storage under pressure. Installed
// home-screen apps on iOS are already exempt from Safari's seven-day rule; this
// covers the rest.
navigator.storage?.persist?.().catch(() => {})

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
