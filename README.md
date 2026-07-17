# pi-pins

A [pi](https://github.com/earendil-works/pi-coding-agent) extension to **pin assistant messages** and recall them in an interactive overlay browser — without taking permanent screen space.

## Why

Long conversations bury useful answers (tables, plans, command outputs). Pin them the moment they appear, recall them later in a floating markdown-rendered overlay.

## Commands

| Command | Description |
|---|---|
| `/pin [label]` | Pin the last assistant message (label is any free text; auto-generated if omitted) |
| `/pin pick` | Interactively pick one of the last 10 assistant messages to pin |
| `/pin show [n]` | Open the pin browser (optionally pre-selecting pin `#n`) |
| `/pin rm <n>` | Remove pin `#n` |
| `/pin clear` | Remove all pins (IDs restart from 1) |
| `/pin help` | Show help |

## Browser keys

| Key | Action |
|---|---|
| `↑` / `↓` | Scroll content line by line |
| `PgUp` / `PgDn` | Switch between pins |
| `g` / `G` | Jump to top / bottom of content |
| `q` / `Esc` / `Enter` | Close the overlay |

## Features

- **Interactive master-detail browser**: pin list + live markdown preview, rendered like the chat transcript (tables, headings, code)
- **Dismissible overlay**: anchored to the top of the screen, 80% height, closes without a trace — no persistent widgets
- **Session-persistent**: pins are stored in the session file itself (`pi.appendEntry`), so they survive `/reload`, restarts, and `/resume`, and follow session tree branches
- **Tab completion** for all subcommands

## Install

```bash
pi install git:git@github.com/s4lv0/pi-pins
```

Then `/reload` in pi.

## License

MIT — see [LICENSE](./LICENSE)
