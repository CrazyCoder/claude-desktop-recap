# desktop-recap

A Claude Code mod that brings the terminal's session recap to the Claude
desktop app's Code tab.

In the terminal, Claude Code drafts a one-line recap when you come back to a
session after a few minutes away. The desktop app does not show it. This mod
draws the same kind of recap above the prompt:

```
※ recap: You're fixing a failing build after an upstream rebase. Next: re-run the build.
```

## Install

In a terminal Claude Code session:

```
/plugin install desktop-recap --marketplace CrazyCoder/claude-desktop-recap
```

Answer `y` to add the marketplace and pick the user scope. Sessions the desktop
app starts load it from then on.

## How it works

- **When.** After the session has been idle for `awayMinutes` (default 3)
  following Claude's last reply, in a session with at least three turns. The
  desktop app gives a mod no window-focus signal, so idle time stands in for
  "away". Resuming a session, or the app reopening it, recaps at once when the
  session has already been idle that long.
- **How.** One tool-less request over the session's own transcript, served
  from the prompt cache, the way the terminal makes its recap. Nothing is added
  to the transcript or to what the model reads.
- **Where.** A line above the prompt with a Dismiss button. Your next prompt
  takes it down.
- **Reuse.** A recap is kept for the point of the transcript it covers. With
  nothing new since, the next idle period, a reload or an app restart shows the
  kept recap and makes no new request. A `/recap` you run yourself counts as
  that recap, and the band does not repeat it.

## Settings

| Option | Default | What it does |
| --- | --- | --- |
| `awayMinutes` | `3` | Idle minutes after Claude's last reply before the recap shows (1-120). |
| `prompt` | empty | What the model is asked when it drafts a recap. Empty uses the built-in prompt. |

Each is a row in the terminal's `/config`, or set them in
`~/.claude/settings.json`:

```json
"pluginConfigs": {
  "desktop-recap": {
    "options": {
      "awayMinutes": 10,
      "prompt": "In one sentence: what am I working on, and what is the next step?"
    }
  }
}
```

The built-in prompt is `DEFAULT_PROMPT` in
[hooks/register.tsx](hooks/register.tsx). A kept recap is reused only while
it was made with the current prompt, so a new prompt takes effect at the next
recap.

## Development

```
claude plugin validate .
claude plugin test .
```

## Credits

The recap prompt comes from
[pi-session-recap](https://github.com/CrazyCoder/pi-session-recap) by Thomas
Mustier (MIT).

## License

MIT
