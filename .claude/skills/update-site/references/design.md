# The page's design language

The page is a late-80s PC on a dark desk: beige plastic, a lime phosphor glow, one pixel font. Every change should
look as if it was always there. Read `site/css/site.css`'s `:root` before adding a colour or a size.

## Tokens

| Token | Use |
|---|---|
| `--bg` `#101010`, `--surface`, `--line` | The desk, panels and hairlines |
| `--lime` `#50d010`, `--lime-2` `#70d030`, `--green-deep` | The glow, links, accents. **Lime and green only: no pink, no purple** |
| `--cream`, `--beige`, `--khaki` | Text, the monitor's plastic, quiet labels |
| `--glow-soft`, `--glow-hot` | Box-shadow glows; hot for hover and "on" moments |
| `--font-display` | Web437 IBM VGA 8x16: headlines, labels, OSD. Crisp only at 16, 32, 48, 64 px; never bold |
| `--font-body` | System sans for paragraphs |

## Parts to reuse

- **The monitor** (`.monitor`, `.monitor__bezel`, `__screen`, `__chin`, `__stand`): beige gradient plastic, a 4:3
  screen with an inner lime glow. As the studio TV (`.tv`) it shows channels.
- **The studio TV** (`.tv__*` in site.css, the TV block in site.js): channels in `.tv__ch` (`hidden` when off), a
  CRT shrink between them (`.is-off` → `.is-dark` → `.is-on`, keyframes `crt-*`), an OSD that pops up large then
  fades, beige chin buttons. A new channel is one more `.tv__ch` with `role="group"`, `aria-roledescription="slide"`
  and an "n of N" label; update every label's count.
- **Cards** (`.card` with `data-glow`, a cursor-following glow), **tags** (`.tags`), **buttons** (`.btn--primary`,
  `.btn--ghost`), **`.link-arrow`** for "more" links, **section heads** (`.sechead`, an eyebrow number `01`..).
- **Pixel icons**: inline SVG, `shape-rendering="crispEdges"`, drawn on a small grid and shown at a whole multiple.

## Motion

- Only `transform`, `opacity` and `filter` animate (smooth on a phone).
- Entrances are fades and short rises (`power-on`, `[data-reveal]`), never bounces or flicker.
- Physical feel: ease-in to switch off, a slight overshoot and a bloom to switch on, a phosphor afterglow.
- Every loop has a pause (`.flow__pause`, the TV's pause button) and none runs under reduced motion.

## Rules of the page

- CSP meta in `index.html`: no inline style or script, images from the page's own origin only, YouTube only after a
  click.
- Relative URLs for the page's own files; absolute GitHub URLs for docs.
- One `<h1>`; every `<img>` has real alt text and `width`/`height` (no layout shift).

## The bar

The user's words for the studio showcase: "make sure the updates to the site are as high quality as the site is
today. it should look fuckin dope!" Check at three widths, watch every animation through a full loop, and record it
before calling it done.
