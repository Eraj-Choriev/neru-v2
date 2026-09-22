# Liquid Glass navigation

The dock uses the “Light Background” variant from
https://github.com/clayharmon/webgl-liquid-glass at commit
`a0bbc4766f3d7b65ed46765811ddd68d669f3a03` (MIT, Clay Harmon).

`js/vendor/liquid-glass.js` contains the upstream shaders and renderer,
converted from TypeScript to a browser global with Node's
`stripTypeScriptTypes(source, { mode: 'transform' })`. The upstream imports
and exports were removed before conversion. License: `js/vendor/LICENSE-liquid-glass.txt`.

`js/liquid-glass.js` adapts the renderer to our existing buttons and CSS lens.
It reads the animated lens geometry, supplies pointer/press inputs, redraws
only during interaction/resize, and caps rendering resolution at 2x via the
upstream renderer. React, gyroscope access and the upstream React navigation
component are not included. Existing navigation and drag handlers remain authoritative. The upstream
spring integrator now drives lens position and width, with press deformation
and velocity-dependent stretching. CSS brightness/saturation provides the
optical lens treatment from the preview, instead of a second blur layer.

CSS handles actual backdrop blur; WebGL adds highlights and chromatic edges,
not map tile refraction. No map pixels are copied into the canvas. If WebGL is
unavailable, CSS keeps navigation functional. Reduced motion disables tracking
and lens animation; reduced transparency hides the canvas and uses solid fills.
The pale neutral dock uses dark active labels and grey inactive labels. Its fill
is slightly denser than the upstream demo to remain readable over map details.
