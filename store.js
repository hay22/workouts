// Workout history, kept on the phone. Ported from Headquarters'
// server/workouts.js: the same rules, run over an array in localStorage
// instead of a SQLite table. Everything except load/persist is pure, so the
// rules can be checked without a browser.

const KEY = 'lift.workouts'

/* --------------------------------------------------------------- storage */

// Private browsing and a full quota both make localStorage throw rather than
// return null, so every access is guarded.
export function load() {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? sortWorkouts(list) : []
  } catch {
    return []
  }
}

/** Returns false when the write failed, so the caller can say so. */
export function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

export const sortWorkouts = (list) =>
  [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''))

const uid = () =>
  globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/* ----------------------------------------------------------------- maths */

export function normalizeExercises(raw) {
  const out = []
  for (const ex of Array.isArray(raw) ? raw : []) {
    const name = str(ex?.name, 80)
    if (!name) continue
    const sets = (Array.isArray(ex.sets) ? ex.sets : [])
      .map((s) => ({ weight: Number(s?.weight) || 0, reps: Number(s?.reps) || 0 }))
      .filter((s) => s.reps > 0 || s.weight > 0)
    out.push({ name, sets })
  }
  return out
}

export function workoutVolume(w) {
  let v = 0
  for (const ex of w.exercises || []) {
    // Bodyweight sets still count as work; weight 1 keeps them from being zero.
    for (const s of ex.sets) v += (s.weight || 1) * s.reps
  }
  return Math.round(v)
}

export const bestSet = (ex) => ex.sets.reduce((b, s) => (s.weight > (b?.weight ?? -1) ? s : b), null)

export const exerciseVolume = (ex) => ex.sets.reduce((s, x) => s + (x.weight || 1) * x.reps, 0)

const sameType = (a, b) => a.toLowerCase() === b.toLowerCase()

/** Newest-first order: is a logged before b? */
const isBefore = (a, b) => a.date < b.date || (a.date === b.date && (a.createdAt || '') < (b.createdAt || ''))

/**
 * Everything logged up to and including this workout. An old session in the
 * history has to be judged against what came before it — comparing it with
 * last week's session made every older row look like a jump forward.
 */
const upTo = (all, w) => all.filter((x) => x.id === w.id || isBefore(x, w))

/** The most recent workout of the same type logged before this one. */
export function previousSameType(all, workout) {
  return sortWorkouts(upTo(all, workout)).find((w) => sameType(w.type, workout.type) && w.id !== workout.id) || null
}

/**
 * Heaviest weight seen for an exercise within one workout type — drives the
 * all-time-best badge. Scoped by type because the same movement is worked
 * differently in different sessions.
 */
export function allTimeBest(all, name, type) {
  let best = 0
  for (const w of all) {
    if (!sameType(w.type, type)) continue
    for (const ex of w.exercises) {
      if (ex.name.toLowerCase() !== String(name).toLowerCase()) continue
      for (const s of ex.sets) best = Math.max(best, s.weight || 0)
    }
  }
  return best
}

// How many past sessions of the same type the starting weight looks back over.
export const PREFILL_LOOKBACK = 3

/**
 * The set to start from when an exercise comes round again: the HEAVIEST set
 * across the last three workouts of that type. One light day does not drag
 * the starting weight down, and a descending series and a ramp-up give the
 * same answer.
 */
export function heaviestAcross(sessions) {
  let best = null
  for (const s of sessions) {
    for (const set of s.sets) {
      if (!best || (set.weight || 0) > (best.weight || 0)) best = { ...set, date: s.date }
    }
  }
  return best
}

/** Distinct types and exercises, newest first — what the logger suggests from. */
export function suggestions(all) {
  const types = []
  const byType = new Map()
  // type -> exercise -> recent sessions of THAT type containing it.
  const history = new Map()

  for (const w of sortWorkouts(all).slice(0, 200)) {
    if (!types.includes(w.type)) types.push(w.type)
    if (!byType.has(w.type)) byType.set(w.type, [])
    if (!history.has(w.type)) history.set(w.type, new Map())
    const forType = history.get(w.type)

    for (const ex of w.exercises) {
      if (!byType.get(w.type).includes(ex.name)) byType.get(w.type).push(ex.name)
      if (!ex.sets.length) continue
      if (!forType.has(ex.name)) forType.set(ex.name, [])
      const sessions = forType.get(ex.name)
      // Newest first, so this keeps the most recent few.
      if (sessions.length < PREFILL_LOOKBACK) sessions.push({ date: w.date, sets: ex.sets })
    }
  }

  const prefill = {}
  for (const [type, forType] of history) {
    prefill[type] = {}
    for (const [name, sessions] of forType) {
      const best = heaviestAcross(sessions)
      prefill[type][name] = {
        weight: best.weight,
        reps: best.reps,
        from: best.date,
        sessionsConsidered: sessions.length,
        // What was actually done last time, not only the pre-filled number.
        last: sessions[0],
      }
    }
  }

  return { types, byType: Object.fromEntries(byType), prefill }
}

/** This session against the last one of the same type — the point of the app. */
export function compare(all, workout) {
  const prev = previousSameType(all, workout)
  const volume = workoutVolume(workout)
  if (!prev) return { previous: null, volume }
  // "All-time best" means best as of that day, not best including the future.
  const history = upTo(all, workout)

  const prevVolume = workoutVolume(prev)
  const prevMap = Object.fromEntries(prev.exercises.map((e) => [e.name.toLowerCase(), e]))

  const exercises = workout.exercises.map((ex) => {
    const p = prevMap[ex.name.toLowerCase()]
    const best = bestSet(ex)
    return {
      name: ex.name,
      volume: exerciseVolume(ex),
      prevVolume: p ? exerciseVolume(p) : null,
      isNew: !p,
      best,
      prevBest: p ? bestSet(p) : null,
      record: best ? best.weight > 0 && best.weight >= allTimeBest(history, ex.name, workout.type) : false,
    }
  })

  return {
    previous: { id: prev.id, date: prev.date, type: prev.type, volume: prevVolume },
    volume,
    prevVolume,
    deltaPct: prevVolume ? ((volume - prevVolume) / prevVolume) * 100 : 0,
    exercises,
  }
}

/* --------------------------------------------------------------- writing */

/** Validates one workout. Throws with a message fit to show. */
function buildWorkout(input, existing, today) {
  const exercises = normalizeExercises(input.exercises).filter((e) => e.sets.length)
  if (!exercises.length) throw new Error('A workout needs at least one exercise with sets')
  const now = new Date().toISOString()
  return {
    id: existing?.id || input.id || uid(),
    date: isDate(input.date) ? input.date : existing?.date || today,
    type: str(input.type, 60) || existing?.type || 'Workout',
    notes: str(input.notes, 1000) || null,
    exercises,
    startedAt: existing?.startedAt || input.startedAt || now,
    createdAt: existing?.createdAt || input.createdAt || now,
  }
}

/** Adds or replaces a workout. Returns the new list and the saved workout. */
export function saveWorkout(all, input, today) {
  const existing = input.id ? all.find((w) => w.id === input.id) : null
  const workout = buildWorkout(input, existing, today)
  const list = sortWorkouts([...all.filter((w) => w.id !== workout.id), workout])
  return { list, workout }
}

export const deleteWorkout = (all, id) => all.filter((w) => w.id !== id)

/* -------------------------------------------------------- import/export */

export function exportData(all) {
  return { app: 'workouts', version: 1, exportedAt: new Date().toISOString(), workouts: all }
}

/**
 * Takes this app's own backup file, Headquarters' /api/workouts response
 * (`{ workouts: [...] }`), or a bare array. Matching ids are replaced, so
 * importing the same file twice changes nothing.
 */
export function importData(all, data, today) {
  const incoming = Array.isArray(data) ? data : Array.isArray(data?.workouts) ? data.workouts : null
  if (!incoming) throw new Error('That file has no workouts in it')

  let list = [...all]
  let added = 0
  let updated = 0
  let skipped = 0
  for (const raw of incoming) {
    try {
      if (!isDate(raw?.date)) throw new Error('no date')
      const existing = raw.id ? list.find((w) => w.id === raw.id) : null
      const w = buildWorkout(raw, existing, today)
      list = [...list.filter((x) => x.id !== w.id), w]
      existing ? updated++ : added++
    } catch {
      skipped++
    }
  }
  return { list: sortWorkouts(list), added, updated, skipped }
}
