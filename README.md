# Express Roofing Solutions — redesign-v2

Static HTML/CSS/JS site for [expressroofingsolutions.com](https://expressroofingsolutions.com).
Hosted on Netlify from the `main` branch. This redesign lives on `redesign-v2` until approved.

## Brand
- Navy: `#0f2334` / `#16304a` / `#1b3a58`
- Lime accent: `#8cd102`
- Light bg: `#f5f7f6`
- Fonts: Sora (headings) + Inter (body)

## v3 design system
- Shared SVG icon sprite (inline `<symbol>`s) at top of every page — no emoji, no icon font
- Hero: real ERS aerial photo full-bleed (responsive WebP 800/1280/2048), parallax, animated lime roofline SVG
- Home sections: marquee, animated counters, bento services, before/after slider (before = labeled placeholder), sticky process timeline, SVG service-area map, FAQ (+FAQPage schema), final CTA, contact
- All motion disabled under `prefers-reduced-motion`
- GHL iframe must NOT use `loading="lazy"` (form_embed.js never loads it)

## Lead form
GoHighLevel / LeadConnector embed form ID `tL4KaNTXYQRjmjstzhF3` must stay on the homepage contact section.

## Local preview
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Kyle still needs to supply
- Real job photos (service cards, gallery, before/after)
- Real customer reviews (testimonials section is hidden until then)
- Street address (intentionally omitted from schema/pages)
- GAF product line / color chart / exact warranty term copy
- Confirmation of any financing partner language before getting specific
