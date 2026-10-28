# Workouts

A strength-workout log for the iPhone home screen. Plain HTML and JavaScript,
no build step. Everything is stored on the phone; nothing is sent anywhere.

- **Log** a workout by type, with the starting weight pre-filled from the
  heaviest set in your last three sessions of that type.
- **History** compares each session with the previous one of the same type.
- **Backup** exports and imports a JSON file (Headquarters' `/api/workouts`
  output imports too).

## Running it locally

```bash
python -m http.server 8810
```

then open <http://localhost:8810>.

## Releasing a change

Bump `VERSION` in `sw.js`, commit, and push. The phone picks up the new
version on the next launch after it has been online.

Icons are drawn by `python tools/make_icons.py`.
