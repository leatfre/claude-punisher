# Contributing

Thanks for looking. This is a small project — reports are worth as much as code.

## The most useful thing you can do

Run it on **macOS or Linux** and tell us what happened. Those paths are written and handled
explicitly in the code, but nobody has verified them on real hardware yet. A one-line issue
saying "works on Fedora 41 / GNOME 47" is genuinely valuable. So is "it shows an opaque
rectangle".

Same goes for unusual monitor setups. The window has to stretch across every screen, and
operating systems have opinions about that.

## Reporting a bug

Open an issue and include:

- OS and version
- `node --version`
- The `[punisher]` line the app prints at startup — it reports the monitor count and the
  window size requested vs obtained
- What you expected, and what happened instead

## Development

```sh
npm install
npm start          # server only, no window
npm run widget     # the floating widget
npm run test-whip  # fire one whip without an agent
```

There is no build step. `server.js`, `mcp.js` and `hooks/detect-fail.js` are plain Node with
zero dependencies; Electron is only the window.

### About `widget.html`

`widget.html` is a **bundler artifact**, not hand-written source. Line 378 is a JSON asset
manifest and line 390 is the whole widget HTML as a JSON-escaped string. Editing it by hand
is easy to get wrong: the bundler escapes `</` as `</` so a closing tag cannot terminate
the containing `<script>`, and re-serialising with a naive `JSON.stringify` will silently
break the page with `Error unpacking: Unterminated string in JSON`.

If you need to change the character or the animation, patch that line programmatically and
re-serialise with:

- manifest: `JSON.stringify(obj)` compact
- template: `JSON.stringify(str)` with non-ASCII left as-is, then `.replace('</', '<\\u002F')`

## Style

- Comments explain **why**, not what. If a line looks odd, the comment should say what bit us.
- No new runtime dependencies without a reason worth writing down.
- The hook must always exit 0 and never write to stdout. It cannot be allowed to block the
  agent, ever.

## Translations

Language strings live in the `IDIOMAS` table at the top of `desktop.js`. Each entry needs the
whipping sound, the apology line, and the menu labels. Keep the apology short — it has to fit
in a speech bubble.
