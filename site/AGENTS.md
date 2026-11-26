# site

> The product page for `https://metalhexx.github.io/rebeep/`: plain HTML, CSS and JS, no generator.

## What's here

| Path | Role |
|---|---|
| `index.html` | The whole page. Holds the CSP meta, the release markers, and the monitor's channels: the studio's splash, its patch editor and the video slot |
| `css/site.css` | All styles. Lime and green glow, one pixel font |
| `js/site.js` | The monitor's channels, the video facade and small page behaviour. No libraries |
| `img/` | Logo, favicons, the social card, and `studio/`: copies of `docs/images/studio` (made together by the `update-site` skill) |
| `fonts/` | Web437 IBM VGA 8x16 (CC BY-SA 4.0), with its licence file beside it. The footer credits it |

`rebeep site create` copies this folder to `build/site/` (never committed) and stamps the latest
release between `<!-- release:start -->` and `<!-- release:end -->`. `.github/workflows/pages.yml`
deploys that build.

## Rules

- **No version written by hand.** The page carries none: the build stamps it from the latest
  release, and falls back to a plain latest-release link when the lookup fails.
- Keep the release markers: exactly one pair, with the fallback link between them.
- **Relative URLs for the page's own files** (`css/site.css`, never `/css/site.css`).
- Docs are absolute links, `https://github.com/MetalHexx/rebeep/blob/main/...`: the docs are not on
  the site.
- **No third-party request before play.** The YouTube embed (`data-video-id`) loads only after a
  click. With no id the slot says "coming soon".
- Keep the CSP meta in `index.html`, and no inline `<style>`, `<script>` or `style=""`.
- Lime and green glow only: no pink, no purple.
- Every asset under 1 MiB (the repo guard); `site check` holds the build to 500 KB. A picture loads
  only when its channel is next. The channels pause: a button, hover, focus, off screen, reduced motion.
- **No game names in file paths.** The payload guard flags "grand prix" in a path.
- The font's licence file stays beside the font.

## Pitfalls

- Pages serves the site under `/rebeep/`. A root-absolute URL works on a laptop and breaks live.
  `site run` serves under `/rebeep/` too, so you see it before you deploy.
- A YouTube embed needs a referrer: under `no-referrer` it fails with error 153. The page sets
  `strict-origin-when-cross-origin`; keep it on the meta and on the iframe.
- `workflow_run` and `workflow_dispatch` use the copy of the workflow on `main`, so the Pages
  trigger can't be tried from a PR. The first real run is the merge. The owner sets Settings, Pages,
  Source to "GitHub Actions" before it.
- Live reload, the font trial and `__dev/preview#demo` (three widths) exist only in the dev server.

## Run / test

```sh
rebeep site run                   # http://127.0.0.1:8086/rebeep/, rebuilds and reloads on save
rebeep site create [--offline]    # build and stamp build/site/
rebeep site check                 # weight, links, https, alt text, one h1, CSP, markers
```

`REBEEP_GITHUB_API` points the release lookup at a test server. CI runs `site create --offline` and
`site check`.

## Related

- [tools/AGENTS.md](../tools/AGENTS.md): the `site` noun · [releasing](../docs/lab/releasing.md)
