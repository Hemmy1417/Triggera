# Design — Resend school (black velvet with violet neon)

The user supplied this reference for Triggera on 7 Sep 2026. It is a terminal
wrapped in a luxury interface: a pure black canvas, hairline graphite borders
instead of shadows, an editorial serif hero, and a monospaced voice that
carries the technical identity. That is what a verification desk should feel
like, so the system is adopted as given. What follows is the reference plus the
decisions Triggera makes inside it.

## Tokens

| Token | Value | Where it is allowed |
|---|---|---|
| `--void` | `#000000` | the whole canvas, every card surface |
| `--hairline` | `#292d30` | every 1px border: cards, inputs, code windows, dividers |
| `--white` | `#ffffff` | headings, button labels |
| `--bone` | `#f0f0f0` | body text, the primary reading colour |
| `--ash` | `#a1a4a5` | muted text, metadata, icon strokes |
| `--smoke` | `#abafb4` | captions, inactive text |
| `--iron` | `#6e727a` | disabled states, low-emphasis strokes |
| `--charcoal` | `#464a4d` | text that should disappear into the surface |
| `--iris` | `#9281f7` | THE brand accent — code strings and technical identifiers ONLY |
| `--iris-glow` | `#baa7ff` | violet text accent, the "clicked" status dot |
| `--signal` | `#3b9eff` | filled action colour; used for selected navigation, never for a primary CTA |
| `--sky` | `#70b8ff` | blue text accent / status |
| `--green` | `#3ad389` | status only |
| `--red` | `#ff9592` | status only |
| `--amber` | `#ffca16` | status only |

Radii: **16px** cards and code windows, **6px** buttons, badges, inputs, **24px**
large panels, **9999px** the announcement pill. Two values per surface, never
mixed. Base unit 4px; page max-width 1200px; section gap 96px; card padding
32px; element gap 16px.

## Type

| Face | Substitute | Duty |
|---|---|---|
| Domaine | Playfair Display | the hero statement ONLY, 96px / 400 / −0.01em / 1.0 |
| aBC Favorit | Inter Display | section headlines, 56px / 400 / **−0.05em** — the signature compression |
| Inter | Inter | all prose and UI chrome, 12–24px, weights 400/500/600 |
| Commit Mono | JetBrains Mono | every reading, threshold, epoch, hash, id, domain and code block, 12–16px |

The split is the product: Inter explains, Commit Mono states the record, and
Domaine speaks once per page.

## Triggera's decisions inside the system

- **Violet is the record's colour, not decoration.** `--iris` marks technical
  identifiers exactly as the reference marks email addresses: policy ids, tx
  hashes, publisher domains, source ids. It never fills a button and never
  colours a heading.
- **Status colours carry the determination, and nothing else.** Dots at 2–3px
  beside a Commit Mono label: `--green` SATISFIED, `--red` NOT_SATISFIED,
  `--amber` UNDETERMINED, `--sky` investigating or pending, `--ash` draft or
  expired. A publisher's reading is qualifying (green) or contradicting (red)
  in the evidence explorer, and nowhere else does a hue mean anything.
- **Buttons stay ghost.** Transparent, 1px `--hairline`, white label, 6px
  radius, border brightening to white on hover. The one legal action per view
  is the only one shown; a bonded appeal states its bond beside the button.
- **Elevation is a border.** No shadow anywhere except the faint 1px ring the
  reference allows on icon containers.
- **The decision record reads as a terminal window.** 16px radius, hairline
  border, Commit Mono, violet identifiers, and the panel's own reason quoted
  in Inter beneath it — the code-window-as-product-proof pattern, applied to
  evidence.
- **Motion stays at 150ms ease-out**, fade-and-slide on the hero only.

## The rules from the last build that still bind

- **No raw output in primary content.** Nulls, enum spellings, hashes, URLs,
  epochs and ids appear as words or inside a copy-button technical fold. A
  monospaced hash is still a hash: it belongs in the fold, not in a sentence.
- **App anatomy, not a marketing page.** Persistent navbar with the network
  pill and the wallet; a data-first hero whose centre is live protocol state;
  row-cards with human titles; a sticky action rail; an activity timeline.
- Comparable rows are tables; numbers never render lighter than their labels;
  every deadline is stated with its consequence; loading, empty and unreachable
  are three different sentences.
