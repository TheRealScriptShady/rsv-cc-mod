# RSVP reader

Speed-read the current Claude conversation one word at a time in a panel beside the chat.
Each word's focus letter is red and stays in the same column, so your eyes don't move.

Open it with `/rsvp` (or `/rsvp latest`, `/rsvp claude`, `/rsvp all`). Click the panel so it gets your keys.

| Key | Does |
| --- | --- |
| Space | Play / pause (skips past a code block) |
| Up / Down | Speed +/- 25 WPM (150 to 900, remembered) |
| Left / Right | Previous / next sentence |
| 1 / 2 / 3 | Latest reply / Claude's replies / whole thread |
| c | View the code block on screen |
| Click the bar | Jump to that point |

Works in the desktop app and the terminal (mobile and VS Code cannot run the live widget).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install rsvp-reader --marketplace TheRealScriptShady/rsv-cc-mod
```

Answer `y` to add the marketplace, then pick a scope (user scope is first).

From a shell:

```bash
claude plugin install rsvp-reader --marketplace TheRealScriptShady/rsv-cc-mod
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `TheRealScriptShady/rsv-cc-mod`, then Add plugin.

## Develop

```bash
claude plugin validate .
claude plugin test .
```
