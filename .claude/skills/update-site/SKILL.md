---
name: update-site
description: Change ReBeep's product page (site/) and see it before the merge. Use when editing anything under site/ or its images, retaking the ReBeep Studio screenshots (the site's monitor, docs/images/studio, the README), or when asked to preview or record the site.
---

# update-site

The page is plain HTML, CSS and JS in `site/` ([site/AGENTS.md](../../../site/AGENTS.md) holds its rules). This is the
loop for changing it fast and seeing every width before a commit. The bar is the page as it stands: every change looks
as finished as the rest of it ([references/design.md](references/design.md)).

## The loop

1. **Serve it.** Start the dev server in the background and leave it running:

   ```sh
   node tools/rebeep.mjs site run --offline     # --offline skips the release lookup
   ```

   - `http://127.0.0.1:8086/rebeep/` is the page; it rebuilds and reloads on every save under `site/`.
   - `http://127.0.0.1:8086/rebeep/__dev/preview` shows desktop (1440), tablet (768) and phone (390) side by
     side. Add a section's id to open all three there: `__dev/preview#demo`.
   - A change to `tools/lib/sitedev.mjs` or `siteserve.mjs` needs a restart of the server.
2. **Open both in Chrome.** Load the Chrome tools in one ToolSearch (tabs_context_mcp, tabs_create_mcp, navigate,
   computer, javascript_tool, read_console_messages, read_network_requests, gif_creator).
3. **Edit `site/`.** The frames reload on save.
4. **Look closely.** Screenshots lag about a second behind the page, so check timed states (the monitor's channels,
   its OSD) with `javascript_tool`: read classes and computed styles. To see one frame of a CSS animation, pause it at
   a time: `document.getAnimations()`, then `a.pause(); a.currentTime = ms`. Use the `zoom` action for detail.
   For motion, record it in real time in a headless browser of its own (Chrome or Edge, and ffmpeg):

   ```sh
   node .claude/skills/update-site/scripts/record.mjs --at .tv --crop --seconds 20 --out <folder>/tv
   # --width 390 --height 844 for a phone, --reduced-motion; then ffmpeg -ss <t> -i tv.mp4 -frames:v 1 f.png
   ```
5. **Check behaviour:**
   - the console has no errors (`read_console_messages`, pattern `error|warn`);
   - the network shows nothing third-party before play, and the monitor's hidden channels load only when next;
   - reduced motion: nothing moves on its own (read the `@media (prefers-reduced-motion)` rules; the user can try it
     with Windows' animation effects off);
   - the keyboard: Tab reaches every control, with a visible focus ring.
6. **Build and check:**

   ```sh
   node tools/rebeep.mjs site create --offline
   node tools/rebeep.mjs site check              # 500 KB budget, links, alt text, one h1, CSP, markers
   ```

7. **Run the tools suite** if `tools/` changed: `node tools/rebeep.mjs test run --suite tools`.
8. **Record it for the user** before any commit: `record.mjs` over a full loop of anything that moves (it writes an
   MP4 and a GIF), plus stills of `__dev/preview`. Keep them outside the repo. Never commit or push without the
   user's word.

## The studio screenshots

The site's monitor shows ReBeep Studio's splash and its patch editor; `docs/images/studio/` holds every screen for the
guide and the README. They are taken from the real studio in 86Box, and retaken together whenever a captured screen
changes: [references/studio-shots.md](references/studio-shots.md).

## Rules

- No new dependency, no library, no build step. The CSP stays: no inline `<style>`, `<script>` or `style=""`; JS
  changes classes and CSS custom properties only.
- Lime and green glow only. One pixel font (Web437 IBM VGA 8x16) at multiples of 16 px.
- Anything that moves by itself has a pause control, holds on hover and focus, stops off screen, and stays still
  under reduced motion (WCAG 2.2.2).
- Pictures are lossless (text must stay sharp) and load only when needed (`loading="lazy"`, or warmed just before).
- Docs links are absolute `https://github.com/MetalHexx/rebeep/blob/main/...`.
