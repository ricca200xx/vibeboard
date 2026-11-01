# vibeboard

An infinite canvas of real terminals for orchestrating CLI coding agents (Claude Code, Codex,
Gemini, Aider, OpenCode, Copilot CLI and more), side by side, from one place. You do not need to know
the terminal: every agent also has a simple view, with a conversation and plain buttons.

> Early release. Mac only for now.

## Download

Get the latest disk image from [Releases](https://github.com/ricca200xx/vibeboard/releases/latest):
`-arm64` for Apple silicon, the other one for Intel Macs. Open it and drag vibeboard to Applications.

vibeboard is free and not signed with a paid Apple Developer ID, so macOS blocks it the first time:

1. Open vibeboard and press **Done** on the warning.
2. Go to **System Settings → Privacy & Security**, scroll down and press **Open Anyway** next to vibeboard.
3. Open it again and confirm.

You also need at least one coding agent on your Mac. If there is none, vibeboard offers to set up
Claude Code. It types the install command into a terminal and you press Return to run it.

## What it does

- **A simple view.** Each agent can show a conversation instead of a terminal: a plain sentence about
  what it is doing, a box to write in, and buttons when it asks something, with the command it wants to
  run written out. The real terminal keeps running underneath, one click away. Claude Code gets the full
  conversation; other CLIs keep their terminal in view and get the sentence, the box and the buttons.
- **At home on a Mac.** Light and dark themes that follow the system, the system font, and a tooltip on
  everything that has no words.
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
- **Git without a terminal.** The branch pill lists what changed, saves a snapshot (commit) with a
  note you write or Claude writes from the diff, and pushes or pulls (fast-forward only).
- **Studios.** *Code*: browse and edit the repo, put a file on the board as a card. *Documents*: your
  CLI reads the repo (read-only) and writes an overview, onboarding guide, architecture, README, API
  reference, data model or security overview, live on a page you can place on the board or export as PDF.
  *Markdown*: every note in the repo, read, edited or seen as a graph of the links between notes.
  *Diagrams*: right-click the board, "Draw a diagram of this repo" (or ask the command bar), and your
  CLI draws its architecture as areas, boxes and labelled arrows: plain shapes you can move and edit.
- **Mission map, notes, sketches, web tiles, kanban, usage stats** and multiple workspaces per project.

## Requirements

- macOS
- The agent CLIs you want to use, installed and on your `PATH` (vibeboard detects them)

## Run it from the source

You need Node.js 24 or newer (Linux likely works, untested).

```bash
npm install
npm run dev        # server on 127.0.0.1:4317, app on http://localhost:5173
```

Production build:

```bash
npm run build
npm start          # serves the app on http://127.0.0.1:4317
```

Desktop app (Electron, macOS): a real window where web tiles open any site, Google included, and
have an inspector. It starts the same server with your own Node, or reuses one already running:

```bash
npm run desktop
```

The disk images (they carry their own Node, in `release/`):

```bash
npm run dist
```

If npm skipped Electron's download (some npm setups block install scripts), fetch it once with
`node node_modules/electron/install.js`.

Tests (start their own server on a throwaway home folder):

```bash
npm test
```

Board state, loops and the injected Claude hook settings live in `~/.vibeboard/`.

## Security

The server listens on `127.0.0.1` only and accepts requests from its own pages (Origin and Host are
checked, which also blocks DNS rebinding). It has no authentication token, so any program running as
your user on the same machine can drive the consoles. Don't expose the port. A lead's helpers run with
the lead's own permission mode (Auto-approve only if the lead is), and a lead runs at most six at a time.

The buttons of the simple view only ever press the keys the terminal itself would take. Before answering,
the server checks that the question is still on screen and that the right option is highlighted.
Nothing is ever approved on its own.

## Roadmap

1. **Signed app**: an Apple Developer ID, so that macOS opens it without the warning, then auto-update.
2. **Public release**: contribution guide, CI on every change.

## Inspiration

Inspired by [Symvibe](https://www.symvibe.com/). vibeboard is an independent open-source project,
not affiliated with or endorsed by Symvibe or Apple; no code or assets from them are used.

## License

[MIT](LICENSE) © 2026 Riccardo Niccolò Agosti
