# vibeboard

**A board of real terminals for your coding agents, on your Mac.**

![Three Claude Code agents in a group on the vibeboard canvas](docs/screenshots/board.jpg)

vibeboard puts the coding agents you already use, such as Claude Code, Codex and Gemini, side by side
on one infinite canvas. Every console is a real terminal running the real CLI, with your own sign-in and
your own shell. You can group agents and pass work from one to the next. You can see what each one is
doing, and what fills its memory. You do not need to be at home in a terminal: any agent can also show
a plain conversation with buttons.

Free and open source (MIT). Everything runs on your Mac.

## Download

Get the disk image for your Mac from the [latest release](https://github.com/ricca200xx/vibeboard/releases/latest):

| Your Mac | Download |
|---|---|
| Apple silicon (M1, M2, M3, M4…) | `vibeboard-<version>-arm64.dmg` |
| Intel | `vibeboard-<version>-x64.dmg` |

Not sure which one? Open the Apple menu › **About This Mac**. If it says **Chip: Apple M…**, take
`arm64`. If it says **Processor: Intel**, take `x64`.

**You need:**

- macOS 13 Ventura or later.
- At least one coding agent CLI installed, for example [Claude Code](https://docs.anthropic.com/en/docs/claude-code).
  If vibeboard finds none, it offers to set up Claude Code for you. It types the install command into a
  terminal and you press Return to run it.

### Install and first launch

1. Open the `.dmg` and drag **vibeboard** into **Applications**.
2. Open vibeboard. vibeboard is not yet signed with a paid Apple Developer ID, so the first time macOS
   says it cannot check it. Press **Done**.
3. Open **System Settings › Privacy & Security**, scroll down and press **Open Anyway** next to vibeboard.
4. Open it again and confirm. From then on it opens normally.

**To update**, drag the new version into Applications and replace the old one. Your boards are kept.

## Getting started

1. **Open a project folder.** vibeboard lists your recent projects. Each project has its own boards, called workspaces.
2. **Start an agent.** Press **New agent** at the bottom, or right-click the board. It opens in a real terminal,
   in your project folder.
3. **Pick a view.** Each console has **Simple | Terminal** in its header. Simple shows the conversation, a box
   to write in and buttons when the agent asks something. Terminal is the CLI itself.
4. **Make a group.** Drag one terminal onto another, or select several and press **Group**. Groups move,
   resize and get orders together.
5. **Look at the context.** Each Claude console shows how full its memory is. Click it to see what fills it.

![The simple view: an agent asks before editing a file](docs/screenshots/simple-view.jpg)

## How it works

- The app starts a small local server on `127.0.0.1:4317`. Nothing else on your network can reach it.
- Every console is a real pseudo-terminal (PTY) running your agent CLI through your login shell. It sees
  the same `PATH` and sign-ins as your own terminal. Consoles keep running while you switch workspaces,
  and they reattach with their scrollback.
- For Claude Code, vibeboard adds its status hooks with `--settings` for each session. It reads Claude's
  own transcript to show the conversation, the steps and how full the context is. Your global Claude
  configuration is never changed.
- Other agents are followed by their output: working while they print, ready when they stop.
- A question the agent draws on screen, such as "Do you want to proceed?", becomes buttons. A button
  only presses the keys you would press. Before it does, the server checks that the same question is
  still on screen and that the right option is highlighted.
- Your boards live in `~/.vibeboard/`. There is no account, no cloud and no telemetry.

## What it does

**Board and consoles**
- An infinite canvas with real terminals, notes, text, shapes, freehand ink, images, web pages, checklists,
  kanban boards and calendars.
- Several workspaces per project, each with its own board.
- Exact sizes: pick a size for a terminal or a web page, or type width × height. The terminal refits to it.
- Select several things and press ⌫ to close them all. **Undo** brings them back.
- Light and dark themes, following the system or set by hand.

**Several agents at once**
- **Groups and ready-made teams**, such as build then review, or plan, build and review, with the work
  already wired from one to the next.
- **Links between agents.** Drag the dot on a console's edge onto another. Then pick how work passes:
  - *hand the work over* when the first one finishes;
  - *forward every reply*;
  - *only if* a pattern appears;
  - *review*, where the second one checks the first one's work until it says APPROVED;
  - *shared context*.
- **Orchestrator**: a card that sends one order to the agents and groups wired to it.
- **A lead and its helpers**: a lead Claude console can bring in helper consoles on the board when a job
  splits into parts. Claude's own sub-agents show as small cards under their console.
- **Command bar**:
  - `@Maya fix the failing test` sends a prompt to one console;
  - `@Checkout` sends it to a whole group;
  - plain words ("spawn three Claudes in a group called Docs") become board actions.
- **Loops**: repeat an instruction on a schedule, when an agent goes idle or when its output matches,
  until a limit or a goal is reached.
- **Needs you**: a notification and a count in the window title when an agent waits for you or is done.

**Context, memory and your other folders**
- **Context panel**: every agent side by side with how full its memory is, and what fills it (your messages,
  files read, commands, tools). **Compact** or **Clear** it from there.
- **Memory**: notes about the project, written by you or scanned from the repo by an agent, sent to the
  consoles you choose.
- **Connected folders**: connect a folder from outside the project, such as a second brain or your notes,
  under **Context › Folders**. Claude can then read and edit it, and knows it is there. Its notes open in
  the Markdown and Code studios.

![What fills an agent's context](docs/screenshots/context.jpg)

**Files and git**
- **Git without a terminal**: see what changed and the diff of each file, save a snapshot with a message
  you or Claude write, then upload or download. Pulls are fast-forward only.
- **Code studio**: browse and edit the project, and put a file on the board as a card.
- **Markdown studio**: every note in the project, to read, edit, or see as a graph of their links.
- **Documents studio**: your agent reads the repo and writes an overview, an onboarding guide, an
  architecture page, an API reference and more. Export them as PDF.
- **Diagrams**: right-click the board, choose "Draw a diagram of this repo", and your agent draws its architecture as
  shapes you can move.

![The Markdown studio](docs/screenshots/markdown.jpg)

**More**
- Two accounts of the same CLI side by side (Claude Code, Codex), each with its own sign-in.
- Resume a Claude conversation after a restart.
- Usage: your plan's limits and the tokens used per day, read from the agents' own logs on your Mac.
- Mission map: every agent and group at a glance.
- Web tiles: a browser on the board, with your local dev servers one click away.
- Dictation: hold space on the board to talk to the command bar.

![The board in the light theme](docs/screenshots/light.jpg)

## Supported agents

vibeboard runs any of these when they are installed and on your `PATH`, plus a plain shell:

Claude Code · Codex · Gemini CLI · Aider · Cursor CLI · Qwen Code · OpenCode · Grok · Amp · Goose ·
Copilot CLI · Droid · Crush · Kimi CLI · Auggie · Cline · Kilo Code · Codebuff · Continue

| | Claude Code | Other agents |
|---|---|---|
| Real terminal, groups, links, loops, command bar | yes | yes |
| Buttons for the questions it asks | yes | when it draws a menu |
| Working / Needs you / Done status | exact, from its hooks | from its output |
| Conversation in the simple view, context meter | yes | not yet |
| Connected folders | yes (`--add-dir`) | tell it the path |
| Resume, lead and helpers | yes | not yet |
| Second account | yes | Codex |

## Keyboard

| Key | What it does |
|---|---|
| ⌫ or Delete | Close what is selected (consoles included) |
| ⌘Z | Bring back what was just closed |
| ⌘0 | Fit the whole board in view |
| Esc | Leave the current tool, menu or panel |
| Hold Space | Dictate into the command bar (not while typing) |
| Shift- or ⌘-click | Select several things |
| Double-click a console's header | Show it at 100% |
| Right-click | A menu for the board or for what is under the pointer |

## Privacy and security

- The server listens on `127.0.0.1` only. It accepts requests only from its own page: it checks Origin
  and Host (which also stops DNS rebinding) and refuses requests that other websites send through images,
  scripts or links.
- It has no password. Any program running as you on the same Mac can drive your consoles. Do not forward
  the port.
- The app's page runs only its own scripts (Content-Security-Policy), and every piece of Markdown it shows
  is sanitized.
- Web pages inside the board are kept apart from it. In the app they cannot use your camera, microphone,
  location or notifications.
- Agents run with their usual permission prompts. **Auto-approve** (Claude's `--dangerously-skip-permissions`)
  is off unless you turn it on, for all new agents or per agent.
- Nothing is sent anywhere by vibeboard itself. The agents talk to their own providers as they always do.
  Dictation uses the browser's speech service, which may send audio to its vendor. In the app, use the Mac's
  own dictation instead: press fn twice.

Found a security problem? Please report it privately through
[GitHub's security advisories](https://github.com/ricca200xx/vibeboard/security/advisories/new), not in a public issue.

## Your data, and removing vibeboard

| What | Where |
|---|---|
| Boards, memories, loops, account profiles | `~/.vibeboard/` (a backup of the board is kept next to it) |
| The app's window settings | `~/Library/Application Support/vibeboard/` |
| Logs | `~/Library/Logs/vibeboard/server.log` |

To remove vibeboard, quit it, move it from Applications to the Bin, and delete the three folders above.
Your projects and your agents' own settings are not touched.

## Troubleshooting

- **"vibeboard cannot be opened" / "cannot check it for malicious software"**: see
  [Install and first launch](#install-and-first-launch). This happens once.
- **An agent shows as "not installed"**: vibeboard looks for it in the `PATH` of your login shell. Check that
  `which claude` (or the agent's command) works in a new Terminal window, then press **Check again**.
- **"vibeboard could not start"**: another program is using port 4317. A second copy, or `npm run dev`, is
  reused automatically. Otherwise quit that program, or look in the log for details.
- **A console says the project's folder is gone**: the folder was moved or deleted. Open it again from
  its new place.
- **Dictation does nothing in the app**: use the Mac's own dictation (fn twice) in the command bar.

## Build from source

You need Node.js 24 or later.

```bash
npm install
npm run dev        # server on 127.0.0.1:4317, app on http://localhost:5173
npm test           # the test suite (starts its own server on a throwaway folder)
npm run desktop    # the Mac app, from the source
npm run dist       # both disk images, in release/
```

`npm run build && npm start` serves the built app on `http://127.0.0.1:4317` in your browser. In a
browser, sites such as Google refuse to be shown inside a web tile; in the Mac app every site loads.
If npm skipped Electron's download, fetch it once with `node node_modules/electron/install.js`.

A tag such as `v0.2.0` builds both disk images on GitHub Actions and leaves them on a draft release.

## Credits

The agents' marks come from [Lobe Icons](https://github.com/lobehub/lobe-icons) (MIT). They remain the
trademarks of their owners and only name the tool a console runs; see `src/assets/agents/NOTICE.md`.

vibeboard is an independent project, inspired by [Symvibe](https://www.symvibe.com/). It is not affiliated
with or endorsed by Symvibe, Apple, Anthropic or any agent's maker, and it uses no code or assets from them.

## License

[MIT](LICENSE) © 2026 Riccardo Niccolò Agosti
