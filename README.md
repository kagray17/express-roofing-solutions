# Express Roofing Solutions — Starter Site

Plain HTML/CSS/JS, no build step. Inspired by knoxroofs.com (bold, dark, punchy)
and bonedry.com/lafayette (clean service breakdown, trust badges, testimonials).
Palette pulled from the real logo (navy `#0f2334` + lime green `#8cd102`).

## Launch status
**`index.html` is a standalone landing page and is launch-ready on its own.**
The 3 service cards on the homepage are currently unlinked (no "Learn more",
photos aren't clickable) — they don't point anywhere yet.

The service subpages below already exist and are built out, but are
intentionally **not linked from the live site yet** since they still have
placeholder GAF/color/warranty content. Finish filling those in later, then
reconnect them (see "Reconnecting the service subpages" below).

## Files
- `index.html` — the live landing page (hero, services, why us, process, CTA, contact form, footer)
- `asphalt-shingle-roofing.html` — parked for later: GAF overview, color chart, warranty, gallery
- `metal-roofing.html` — parked for later, same template, metal roofing content
- `seamless-gutters.html` — parked for later, same template, gutter content
- `styles.css` — navy + lime green theme (from logo), fully responsive
- `script.js` — mobile nav toggle, sticky header shadow, gallery lightbox (shared across all pages)
- `assets/logo.png` — your logo, used in header/footer (in a white badge so it reads on the dark background)

## Reconnecting the service subpages
Once the 3 subpages have real content (not just the placeholder-note TODOs),
relink them from the homepage:

1. In `index.html`, find the 3 `<div class="service-photo-link">` blocks
   under `id="services"` — change `<div>`/`</div>` back to
   `<a href="asphalt-shingle-roofing.html" class="service-photo-link">`/`</a>`
   (and the matching filename for the metal/gutters cards).
2. Add a `<a href="...html" class="service-link">Learn more →</a>` line back
   in each `<article class="service-card">`, right after the `<p>` description.
3. In the footer, change the 3 `<span>` service names back to
   `<a href="...html">` linking to the matching page.

## Already filled in
- Phone: (765) 490-2914
- Service area: Lafayette, IN & surrounding areas
- Stats: 15+ years experience, 1,000+ roofs completed
- Lead form: embedded GoHighLevel form (`#contact` section, homepage only) —
  submissions go straight into your GHL sub-account (form ID
  `tL4KaNTXYQRjmjstzhF3`). Edit the form's fields, notifications, and
  automations from inside GHL (Sites → Forms), not from this codebase — the
  site just embeds it via iframe + `https://link.msgsndr.com/js/form_embed.js`.
  If the box ever looks too tall/short again, update `data-height` on the
  iframe in `index.html` and the matching `min-height` values in
  `.contact-form-wrapper` / `.contact-form-wrapper iframe` in `styles.css`
  to match the form's real height (grab a fresh embed snippet from GHL to
  see the current value).

## Run it
No build tools needed. Just open `index.html` in a browser, or serve it locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Open in Claude Code
```bash
cd path/to/this/folder
claude
```

## TODO before launch (good first prompts for Claude Code)
1. **Street address & email** — still placeholder (`info@expressroofingsolutions.com`).
   Update in the footer/contact section on every page once you have a real one.
2. **Real photos** — hero, the 3 service card photos, and the gallery photos
   on each service subpage are all free Unsplash stock placeholders right
   now. See "Swapping in real photos" below.
3. **GAF / product content** — each service subpage has a `placeholder-note`
   (dashed box) marking exactly where to drop in real product details, color
   charts, and warranty terms once you send them over.
4. **Reviews** — intentionally left off the site for now since there weren't
   real reviews to use yet. Add a proper reviews section back once you have
   a Google Business Profile with real reviews (or want a live star-rating
   badge instead of static quotes).
5. **SEO basics** — add favicon, `og:image`, sitemap.xml, robots.txt once domain is live.

## Swapping in real photos
Every photo on the site is currently a hotlinked Unsplash stock image (free
for commercial use, no attribution required) so you can see the layout —
none of these are your actual work. To replace them:

1. Drop your photos into `assets/` (e.g. `assets/asphalt-1.jpg`).
2. Homepage hero photo: search `hero-photo` in `index.html`, swap the `src`.
3. Homepage service card photos: search `service-photo-link` (3 of them) in
   `index.html`, swap the `src` on the `<img>` inside each.
4. Gallery photos: each subpage (`asphalt-shingle-roofing.html`,
   `metal-roofing.html`, `seamless-gutters.html`) has its own 3-photo gallery
   under `id="gallery"`. Search `gallery-thumb` — each one has two attributes
   to update: `data-full` (the large image shown in the lightbox) and the
   `<img src>` inside it (the thumbnail). Use the same file for both, or a
   smaller version for the thumbnail if you want faster load times.
5. To add more photos to a gallery, copy an existing `<button class="gallery-thumb">`
   block within that page's `.gallery-grid` and point it at a new image —
   no other changes needed, the lightbox JS handles any number of thumbnails.
6. Color chart swatches: each subpage has a `.color-grid` with 6 placeholder
   `.color-swatch` blocks — replace the inline `background` colors (and the
   "Placeholder N" labels) with your real product colors and names once you
   send over the color chart.

## Design notes
- Font: Inter (body) + Sora (headings), loaded from Google Fonts.
- Palette: navy (`#0f2334`) sections alternating with cool off-white
  (`#f5f7f6`) sections, tied together with a lime green gradient accent
  (`#8cd102` → `#b8e34a`), matching the logo.
- All icons are inline SVG — no image dependencies to break, except the logo.
