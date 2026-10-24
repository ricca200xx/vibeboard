# vibeboard

An infinite canvas of real terminals for orchestrating CLI coding agents — Claude Code, Codex,
Gemini, Aider, OpenCode, Copilot CLI and more — side by side, from one place.

> Early MVP. It runs today as a local web app on macOS; a native macOS app is next on the roadmap.

## What it does

- **Real terminals on a board.** Every console is a real PTY running the agent CLI you choose,
  with your own shell environment. Consoles survive page reloads and reattach with their scrollback.
- **Live status.** Claude Code consoles report *Working*, *Needs you* and *Done* through hooks
  injected per session (your global Claude config is never touched); other agents are tracked by
  output activity.
- **Groups and teams.** Spawn several agents at once, compose a team from roles, group consoles on the
  canvas and move them together.
- **Command bar.** Type `@Maya fix the failing test` to send a prompt to one console, `@Backend` to a
  whole group, or plain language ("spawn three Claudes in a group called Docs") and a planner turns it
  into board actions. Voice dictation with hold-to-talk.
- **Resume.** Claude conversations can be picked back up after a restart.
- **Loops.** Send an instruction on a schedule, when an agent goes idle, or when its output matches a
  pattern, until a run limit, a time limit, or a goal (a command that passes, or a judge agent) is met.
- **Memory.** Per-repo notes (or facts scanned from the repo) pushed into consoles as context.
- **Mission map, notes, sketches, web tiles, kanban, usage stats** and multiple workspaces per project.

## Requirements

- macOS (Linux likely works, untested)
- Node.js 22+
- The agent CLIs you want to use, installed and on your `PATH` (vibeboard detects them)

## Run it

```bash
npm install
npm run dev        # server on 127.0.0.1:4317, app on http://localhost:5173
```

Production build:

```bash
npm run build
npm start          # serves the app on http://127.0.0.1:4317
```

Tests (start their own server on a throwaway home folder):

```bash
npm test
```

Board state, loops and the injected Claude hook settings live in `~/.vibeboard/`.

## Security

The server listens on `127.0.0.1` only and accepts requests from its own pages (Origin and Host are
checked, which also blocks DNS rebinding). It has no authentication token, so any program running as
your user on the same machine can drive the consoles. Don't expose the port.

## Roadmap

1. **Orchestration logic**: groups that grow to fit a console dropped into them, connections between
   consoles so agents can hand work to each other, team templates, "needs you" notifications.
2. **Native macOS app**: a real window with Dock icon, menu bar, shortcuts, notifications, a signed
   `.dmg` and auto-update.
3. **Apple-style interface**: Liquid Glass toolbars and panels, system typography and accent colour,
   light and dark mode.
4. **Public release**: contribution guide, CI, tagged releases.

## Inspiration

Inspired by [Symvibe](https://www.symvibe.com/). vibeboard is an independent open-source project,
not affiliated with or endorsed by Symvibe; no code or assets from it are used.

## License

[MIT](LICENSE) © 2026 Riccardo Niccolò Agosti
