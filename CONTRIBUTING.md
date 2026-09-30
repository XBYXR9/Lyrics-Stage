# Contributing

Thanks for helping! Bug reports, ideas, new lyric styles and fixes are all welcome.

## Getting started

```bash
npm install
npm run app:dev  # the desktop app with live reload
npm run dev      # the web version at http://127.0.0.1:5173 — add /?demo to work without Spotify
```

No Spotify on your Linux dev machine? `node scripts/fake-spotify.mjs` pretends to be the Spotify app on D-Bus (see
[docs/DESKTOP_APP.md](docs/DESKTOP_APP.md)). The macOS and Windows bridges can only be tried on those systems; if you
have one, testing them there is one of the most useful contributions right now.

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run build
```

CI runs the same three commands.

## Where things live

- `electron/`: the desktop app. `bridge/` talks to the Spotify app on macOS, Windows and Linux (tests in
  `electron/__tests__/`).
- `src/lib/`: logic with no UI. Most of it is unit-tested in `src/lib/__tests__/`.
- `src/components/`: React UI. Each lyric style lives in `src/components/styles/`.
- `src/styles/`: CSS. `app.css` holds the layout and controls; `lyrics.css` holds the lyric styles.
- `docs/`: guides. If you change how something works, please update [HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

## Guidelines

- **No servers and no secrets.** Everything happens on the user's computer. The desktop app must never ask for the
  user's Spotify password or read Spotify's private data; it only uses the system media interfaces.
- **Be kind to free services.** LRCLIB is community-run. Cache results and avoid extra requests. Keep Spotify polling
  adaptive.
- **Smooth animation first.** Per-frame work should write to the DOM directly (CSS variables or classes), not React
  state. Re-render only when the current line changes.
- **Accessibility:** keep keyboard shortcuts working, respect `reduceMotion`, and support right-to-left lyrics.
- **Match the code around you:** TypeScript strict mode, small focused modules, short comments that explain *why*.
- **Add tests** for logic changes: parsing, timing, transition detection and matching.

## Adding a lyric style

See [docs/ADDING_A_STYLE.md](docs/ADDING_A_STYLE.md).

## Reporting bugs

Please include:

- your browser,
- whether you were following another device or using "Play here",
- the song (title and artist), if the bug is about lyrics,
- what you expected and what happened.

For timing problems, mention your **Lyrics timing** setting and whether you use Bluetooth audio.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
