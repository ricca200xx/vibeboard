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
- **Groups and teams.** Spawn several agents at once or a ready-made team (plan → build → review…),
  group consoles on the canvas and move them together. A group grows to fit a console dropped into it.
- **Hand-offs.** Drag a wire from one console to another: when the first finishes, a summary of its
  work plus its final reply becomes the next one's prompt.
- **A lead and its helpers.** A lead console (Claude Code) can bring in helper consoles itself when a
  job splits into parts. They appear on the board in its group, work side by side, and their answers
  go back to the lead. Claude's own sub-agents show as small cards under their console.
- **Needs you.** A system notification and a count in the window title when an agent is waiting or
  done; clicking it jumps to that console.
- **Command bar.** Type `@Maya fix the failing test` to send a prompt to one console, `@Backend` to a
  whole group, or plain language ("spawn three Claudes in a group called Docs") and a planner turns it
  into board actions. Voice dictation with hold-to-talk.
- **Resume.** Claude conversations can be picked back up after a restart.
- **Two accounts of the same CLI.** Add an account in Settings and pick it from a console's agent
  menu: Claude Code or Codex then run on that account's own sign-in folder, side by side with the default.
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
your user on the same machine can drive the consoles. Don't expose the port. A lead's helpers run with
the lead's own permission mode (YOLO only if the lead is), and a lead runs at most six at a time.

## Roadmap

1. **More orchestration**: studios (docs, diagrams, code tree), a GitHub commit/push panel, custom
   executables.
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
