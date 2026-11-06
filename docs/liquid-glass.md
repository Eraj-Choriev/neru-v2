# Liquid Glass — the Glisse port (2026-11-05)

The navigation chrome follows Apple's iOS 26 Liquid Glass, ported from
**Glisse** — https://github.com/0kzh/glisse, npm `glisse@0.5.0`,
MIT © 2026 Kelvin Zhang. (The earlier WebGL renderer from
`clayharmon/webgl-liquid-glass` is gone; its files are no longer in the repo.)

Glisse is a React component library. This app has no React and no build, so
the package is **not** installed: its technique and its numbers are ported to
vanilla CSS and ~150 lines of JS.

## What was taken

| Glisse | Here |
|---|---|
| Edge refraction: an SVG `feDisplacementMap` drawn on a canvas per element, applied through `backdrop-filter: url(#…)`, Chromium only | `js/glass.js` (`liquidGlass.attach()`), one map per `[data-glass]` element, cached by size, rebuilt by a `ResizeObserver` |
| Clear glass: `rgb(255 255 255 / .6)`, little blur, saturate 1.5, 0.5px hairline | `--glass-fill`, `--glass-blur` (8px — the map behind is busier than Glisse's demo), `--glass-rim` |
| Rim light along one axis (canvas-drawn) | `--glass-rim`: inset highlights on the top-left and bottom-right edges |
| Springs: selection 1024/58.9, lift 676/47.8, switch 1000/80, touch press 515/27.3 | Sampled into CSS `linear()` curves: `--spring-select` 260ms, `--spring-lift` 300ms, `--spring-switch` 420ms, `--spring-press` 480ms. They run on the compositor; Glisse runs them in JS every frame, which would compete with the WebGL map |
| Tab bar with icons: grey selection pill (`rgb(0 0 0 / .1)`), selected tab in the accent, lens lifts 24×16px while held | `.tabbar-lens .lens-body`, `--glass-selection`, `--glass-accent`, `.is-held` + `--lift-x/--lift-y` |
| Segmented control: track `rgb(118 118 128 / .12)`, white thumb inset 2px, lifts into a lens while held | `--glass-track`, `--glass-thumb`, same `.is-held` lift |
| Switch: capsule track, white pill thumb that swells into clear glass while held | `.notif-switch` restyle; `:active` lifts the thumb (`scale` 1.42) |
| Press: glass grows under the finger, lights where it is touched | `scale: 1.1` on `:active` with `--spring-press`; the tab bar's `::after` glow at `--press-x` |

## What was not, and why

- **Per-channel chromatic dispersion and the lifted lens's own refraction.**
  Both need a displacement map for an element whose size animates; a map drawn
  for one size smears at another. The lens gets brightness/saturation and the
  existing prism rim while it travels instead.
- **JS spring physics.** See above — `linear()` gives the same curve without
  main-thread work.
- **The dark palette.** The app is light-only; `:root` holds equivalents only
  so the tokens are never undefined.

## Browser support

- Chromium (Chrome, Edge, Android WebView): refraction + glass.
- Safari / iOS: no SVG filters inside `backdrop-filter`, so `glass.js` sets
  nothing and the plain blur carries the material. `linear()` needs
  Safari 17.2+; older versions fall back to a linear transition, still correct.
- `prefers-reduced-transparency`: solid fills, no refraction.
- `prefers-reduced-motion`: no lift scale, 1ms transitions.

## Cost

One 358×64 map takes under 20ms to draw once, then it is cached. The filter
itself is a single displacement lookup per pixel on the GPU — cheaper than the
30–44px blurs it replaces on the bars.
