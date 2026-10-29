# Spider interaction regression

Reproduced on the old implementation: opening six points and dragging the
map left all six screen-space buttons visible. `dragstart` is not a MapGL
event, and the map click condition incorrectly assumed background targets
would be absent.

Fix: native pointerdown and wheel capture dismiss existing overlays before
SDK hit testing; the subsequent cluster click can open a new group. MapGL
movestart also clears an expanded group during keyboard/programmatic motion.
Spider buttons and cards are outside the SDK gesture surface, so selecting
one does not dismiss the group. Closing cancels all reveal animations.

Motion: 380ms point expansion and line drawing with a stagger capped at
108ms, plus a 240ms card reveal. Reduced motion skips these effects.

Browser verification using actual mouse input on a live six-station cluster:
- Six markers and six lines animate on open.
- Drag right, drag left, and wheel each leave zero expanded markers.
- Selecting an expanded point opens its card and retains the group.
- A background click closes both the card and group.
- Reduced-motion emulation creates zero reveal animations.

These checks exercise Chromium desktop gestures; physical iPhone gestures
were not tested here. Native pointer events support the same touch-start
dismissal path on current mobile browsers.
