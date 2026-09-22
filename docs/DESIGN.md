# Design System: NŪR — Driver's Utility App

> Source of truth for Google Stitch screen generation.
> Target: native mobile (iOS + Android), light theme only.
> Audience: working taxi drivers in Dushanbe, Tajikistan.
> Written in English because Stitch interprets English prompts more reliably.

---

## 0. Deliberate Deviations From The House Style

This document breaks three defaults on purpose. Reasons stated so they are not
"fixed" later by accident.

| House default | Here | Why |
|---|---|---|
| Variance 8 — asymmetric, artsy | **Variance 2 — predictable, symmetric** | The user is holding a steering wheel. A layout that surprises costs a second of attention, and that second is spent in traffic. Predictability is the feature |
| Motion 6 — fluid, perpetual micro-loops | **Motion 3 — restrained** | Perpetual animation in the driver's peripheral vision reads as an alert. Motion is reserved for state changes that actually matter |
| Fonts: Geist / Satoshi / Cabinet Grotesk | **Manrope + JetBrains Mono** | Those three have no usable Tajik Cyrillic. See §3 — this is a hard blocker, not a preference |

Density: **4** — calm, but not gallery-empty. Every screen answers one question.

---

## 1. Visual Theme & Atmosphere

A quiet, monochrome instrument panel. Near-white paper, near-black ink, and one
disciplined rule that governs everything else:

> **Colour appears only where it carries data. The interface itself is grey.**

Buttons, tab bars, headers, sheets and toggles are neutral. The only saturated
pixels in the entire app are map pins and the status dots that echo them. This
is what makes the app feel minimalist rather than merely plain — the eye learns
in one session that colour always means *category*, never decoration.

The mood is a well-made hand tool: honest, unfussy, legible at arm's length in
direct sunlight, and completely uninterested in impressing anyone.

---

## 2. Colour Palette & Roles

### Interface — monochrome, no exceptions

- **Paper** (`#FAFAF9`) — App background. Warm-neutral, not clinical blue-white
- **Surface** (`#FFFFFF`) — Cards, sheets, bars
- **Ink** (`#1C1C1A`) — Primary text and icons. Off-black, never `#000000`
- **Graphite** (`#6B6B66`) — Secondary text, metadata, inactive tabs
- **Mist** (`#A3A39D`) — Disabled state, placeholder text
- **Hairline** (`#E7E5E1`) — 1px dividers and card borders
- **Ink Wash** (`rgba(28,28,26,0.06)`) — Pressed-state fill

The UI accent is **Ink itself**. A primary button is a solid near-black slab
with paper-white text. There is no blue button, no branded fill, no glow.

### Data — the only colour in the app

**v1 ships two categories only.** Fuel stations and restaurants are deferred;
do not draw them on any screen.

- **Charge Blue** (`#2F5DAF`) — EV charging stations
- **Parking Slate** (`#5A6675`) — Paid parking

Both sit below 80% saturation so they stay calm against a light map.

Reserved for later, not to be used now: Fuel Amber (`#B87608`),
Table Clay (`#A64B3C`).

### Availability — status, not category

- **Open** (`#2F7A55`) — free / open now
- **Busy** (`#B87608`) — occupied, or closing soon
- **Closed** (`#8A8A84`) — unavailable

> Note on the green: the brief bans green as a *brand* colour, and it is gone
> from the interface entirely. It survives in exactly one place — the "free
> now" dot — because green-means-available is a convention drivers already
> read without thinking, and inventing a private replacement would cost
> comprehension for no gain. If this is unwanted, replace Open with Ink and
> carry availability by the filled/hollow dot alone.

### Colour is never the only signal

Fuel Amber and Table Clay converge under deuteranopia, and a windscreen in
direct sun flattens everything. **Every category carries its own glyph**, every
status carries its own dot fill (solid / half / hollow). Colour is the fast
path, never the only path.

---

## 3. Typography

### The Cyrillic constraint comes first

The app ships Tajik, Russian and English. Tajik Cyrillic needs
**ғ ӣ қ ӯ ҳ ҷ** — Cyrillic Extended-A, which most fashionable display faces
simply do not draw. A missing glyph renders as a tofu box in the middle of a
station name.

**Therefore: any font must be verified against the string `ҷғҳқӯӣ` before it is
adopted.** Geist, Satoshi and Cabinet Grotesk fail this and are unusable here
regardless of how good they look.

### The stack

- **Display & Body: Manrope** — Already licensed and in use on the web app,
  genuine Cyrillic coverage, geometric enough to feel designed rather than
  defaulted. Weights: 400 / 500 / 600 / 700
- **Numeric & Metadata: JetBrains Mono** — Distances, prices, tariffs, kW,
  countdown timers. Tabular figures stop numbers from jittering as they tick
- **Banned:** `Inter`, `Roboto`, `SF Pro` as a *brand* face, all serifs

### Scale

| Role | Size / Line | Weight |
|---|---|---|
| Screen title | 28 / 34 | 700 |
| Section header | 20 / 26 | 600 |
| Card title | 17 / 22 | 600 |
| Body | 15 / 21 | 400 |
| Metadata | 13 / 18 | 500 |
| Micro label | 11 / 14 | 600, +0.02em |

**Driver override:** nothing a driver reads in motion goes below **15pt**.
Distance, availability and station name are 17pt minimum. The 11–13pt sizes are
for settings and detail sheets only — screens read while parked.

Hierarchy comes from weight and colour, not from size jumps.

---

## 4. Component Stylings

**Buttons** — Solid Ink fill, Paper text, **56px tall**, **fully rounded
capsule (28px radius)**. Apple's continuous-curve feel: generously round, never
sharp, never a square-cornered slab. Flat — no gradient, no glow, no border.
Pressed state translates down 1px and fills with Ink Wash. Secondary buttons
are Hairline-outlined capsules with Ink text. One primary action per screen.

**Rounding scale** — capsule (999px) for buttons, chips and segmented
controls; 20px for cards and tiles; 28px for sheet top corners; 16px for
inputs. Nothing in the app is sharper than 16px.

**Cards** — Surface fill, 16px radius, 1px Hairline border, **no shadow**.
Elevation is carried by the border and by the Paper/Surface contrast. Shadows
appear only on sheets that genuinely float above the map.

**Map pins** — Circular, 40px, category colour fill, white glyph, 2px white
ring so the pin survives any map background. Selected pin scales to 52px. No
drop pins, no teardrops.

**Cluster bubbles** — Neutral Ink fill with Paper count text. Clusters mix
categories, so a cluster must not claim any one category's colour.

**List rows** — 72px tall, category dot on the left, name and address stacked,
distance right-aligned in mono. Separated by Hairline dividers, **not** by
individual cards — a list of cards is a list of boxes, and boxes cost vertical
space a driver does not have.

**Bottom sheet** — The primary detail surface. Surface fill, 24px top radius,
grab handle, three detents (peek / half / full). Diffused shadow, no blur, no
translucency.

**Tab bar** — A **floating white capsule** resting above the bottom safe area,
20px side margins, ~72px tall, fully rounded, one soft diffused shadow. It is
**static**: identical geometry and identical labels on every screen, no
travelling indicator, no animation, never hidden, never scrolled away.

Five slots, in this fixed order:

| 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|
| Карта | Рядом | **Локация** | Парковка | Настройки |

Slots 1, 2, 4, 5 are tabs: thin outline glyph above an 11pt label, Ink when
active, Graphite when inactive.

**Slot 3 is not a tab — it is an action.** A 60px solid Ink circle carrying a
white location-pin glyph, ringed by a 6px pale grey halo, lifted so it breaks
above the capsule's top edge. It carries no label. Pressing it re-centres the
map on the driver's current position. It never shows a selected state, because
it does not navigate anywhere.

That distinction has to survive into code: four routes plus one button, not
five routes.

**Inputs** — Label above, 52px field, Hairline border, 12px radius, Ink focus
ring. Errors below in Table Clay. No floating labels.

**Loading** — Skeleton rows matching the real row geometry. No spinners.

**Empty states** — One line explaining what will appear here plus the action
that fills it. No illustrations, no mascots.

**Offline** — A persistent Graphite strip: last-updated timestamp plus a retry
affordance. The driver keeps seeing cached points; they are simply told how old
the data is.

---

## 5. Layout Principles

- **Map is the app.** It owns the full screen edge to edge; everything else
  floats above it in sheets or collapses to a bar
- Single column throughout. Nothing side-by-side that could stack
- 8pt spacing grid — 8 / 16 / 24 / 32
- 20px screen margins; 16px card padding
- **Thumb zone rule:** every primary control sits in the bottom third. The top
  of the screen carries information only, never an action the driver must reach
  for while moving
- **Touch targets 56×56 minimum** — above the 44pt baseline, because the
  target is moving and so is the vehicle
- Respect safe areas top and bottom; the tab bar clears the home indicator
- No overlapping elements. No absolute-positioned stacking

---

## 6. Motion & Interaction

Restrained by policy.

- Sheets and screen transitions: spring, `stiffness 100 / damping 20`
- Press feedback: 120ms scale to 0.97, plus a light haptic
- List entry: fade only, no stagger, no cascade
- **No perpetual loops.** No pulsing, shimmering, floating or breathing
  elements. The single exception is the parking countdown, which must visibly
  tick because a stalled timer is indistinguishable from a broken one
- Animate `transform` and `opacity` only
- Honour reduced-motion: transitions collapse to a cross-fade

---

## 7. Anti-Patterns (Banned)

**House rules**

- No emojis, anywhere
- No `Inter`
- No pure black (`#000000`)
- No neon, glow or coloured drop shadows
- No gradient text
- No three-equal-cards row
- No generic placeholder names — use real Dushanbe streets and venues
- No fake round statistics
- No marketing verbs: "Elevate", "Seamless", "Unleash", "Next-Gen"
- No filler UI text: "Scroll to explore", bouncing chevrons, scroll arrows
- No broken image links

**Specific to this product**

- **No glassmorphism, no frosted blur, no translucency.** Explicitly waived by
  the client. Solid fills only
- **No dark theme.** Light only — do not generate a dark variant
- **No green as a brand or interface colour.** It survives solely as the
  "available" status dot (§2)
- **No floating capsule tab bar** and no travelling selection indicator
- **No colour used decoratively.** If a coloured pixel does not encode a
  category or a status, it is a bug
- **No in-app turn-by-turn navigation UI.** The app finds the point and hands
  off to an external navigator — do not draw a navigation HUD
- No bottom sheet that covers more than 60% of the map at its half detent
- No text below 15pt on any screen intended to be read in motion

---

## 8. Screen Inventory

The numbered screen list, the navigation flow and the per-screen Stitch prompts
live in **`docs/screens.md`**. That file is the single source of truth for
*which* screens exist and in *what order*; this file governs *how they look*.

Do not add a screen without giving it a number in `screens.md` first.

## 9. After Stitch

Stitch produces layout and hierarchy, not a shippable app. Expect to correct:

- **Cyrillic.** Stitch will output Latin placeholder text. Every screen must be
  re-checked with real Tajik strings — they are 20–40% longer than English and
  will break any layout tuned to "Charging"
- **Touch targets.** Stitch defaults to web-scale controls; enforce the 56px
  floor
- **Colour discipline.** Stitch likes to tint buttons. Strip any colour that is
  not a category or a status
- **The map.** Stitch draws a picture of a map. The real one is
  `react-native-maps` with `PROVIDER_DEFAULT`, and its own controls will not
  match the mock

Treat the output as a layout reference to build against, not as a spec to
match pixel for pixel.
