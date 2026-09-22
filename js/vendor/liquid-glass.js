/* Adapted from clayharmon/webgl-liquid-glass, MIT, Copyright 2026 Clay Harmon.
 * Upstream a0bbc4766f3d7b65ed46765811ddd68d669f3a03. See LICENSE-liquid-glass.txt.
 * TypeScript converted to a standalone browser global. */
(()=>{
const vertexSource = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
const fragmentSource = `
// Some GL ES 2 fragment stages (Mali-400, early PowerVR SGX) have no highp.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform vec2 u_lightPos;
uniform float u_pillX;
uniform float u_pillWidth;
uniform float u_pillHeight;
uniform float u_navRadius;
uniform float u_transitionVel;
uniform float u_pressAmt;
uniform vec3 u_tintColor;

float sdRoundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
  vec2 p = gl_FragCoord.xy - u_resolution * 0.5;

  // --- Nav shape ---
  vec2 navHalf = u_resolution * 0.5 - 1.0;
  float navDist = sdRoundedBox(p, navHalf, u_navRadius);
  float navMask = 1.0 - smoothstep(-1.0, 0.5, navDist);

  // Nav inner edge highlight
  float navEdge = smoothstep(2.5, 0.0, abs(navDist)) * navMask;

  // --- Pill shape (may extend beyond canvas when inflated) ---
  vec2 pillCenter = vec2(u_pillX - u_resolution.x * 0.5, 0.0);
  vec2 pillHalf = vec2(u_pillWidth * 0.5, u_pillHeight * 0.5);
  float pillR = min(pillHalf.x, pillHalf.y);
  float pillDist = sdRoundedBox(p - pillCenter, pillHalf, pillR);
  float pillMask = 1.0 - smoothstep(-1.0, 0.5, pillDist);

  // Pill inner edge
  float pillEdge = smoothstep(2.0, 0.0, abs(pillDist)) * pillMask;

  // --- Directional light bias ---
  float navYNorm = p.y / (u_resolution.y * 0.5);
  float pillYNorm = (p.y - pillCenter.y) / max(pillHalf.y, 1.0);

  float lightBias = u_lightPos.y * 0.25 + 0.15;
  float navTopWeight = clamp(navYNorm * 0.25 + 0.5 + lightBias, 0.15, 1.0);
  float pillTopWeight = clamp(pillYNorm * 0.3 + 0.5 + lightBias, 0.15, 1.0);

  // --- Soft specular ---
  vec2 lightDir2D = u_lightPos * 0.5 + vec2(0.0, 0.3);
  float lLen = length(lightDir2D);
  if (lLen > 0.001) lightDir2D /= lLen;

  float navAngle = dot(normalize(p + vec2(0.001)), lightDir2D) * 0.5 + 0.5;
  float navSpec = pow(navAngle, 5.0) * 0.04;

  vec2 pRel = (p - pillCenter) / max(pillHalf, vec2(1.0));
  float pillAngle = dot(normalize(pRel + vec2(0.001)), lightDir2D) * 0.5 + 0.5;
  float pillSpec = pow(pillAngle, 4.0) * 0.07;

  // --- Chromatic aberration (refraction) ---
  vec2 pFromPill = (p - pillCenter) / max(pillHalf, vec2(1.0));
  float pDist01 = length(pFromPill);
  float chromStrength = smoothstep(0.35, 1.0, pDist01) * pillMask;

  // Base white, blending toward tint color at pill edges
  vec3 color = vec3(1.0);
  vec3 edgeTint = mix(vec3(1.0), u_tintColor, chromStrength * 0.6);
  color = mix(color, edgeTint, pillMask);

  // RGB split (classic chromatic aberration)
  color.r += chromStrength * pFromPill.x * 0.18;
  color.b -= chromStrength * pFromPill.x * 0.18;
  color.g += chromStrength * abs(pFromPill.y) * 0.06;

  // Tinted edge glow — active color refracts at the pill boundary
  float edgeGlow = smoothstep(0.6, 1.0, pDist01) * pillMask;
  color += u_tintColor * edgeGlow * 0.2;

  // Nav-level chromatic at edges
  vec2 navNorm = p / (u_resolution * 0.5);
  float navChrom = smoothstep(0.6, 1.0, length(navNorm)) * navMask;
  color.r += navChrom * navNorm.x * 0.07;
  color.b -= navChrom * navNorm.x * 0.07;

  // --- Lens brightness ---
  float lensCenter = (1.0 - pDist01 * pDist01) * 0.04 * pillMask;

  // --- Press glow ---
  float pressGlow = u_pressAmt * 0.06 * pillMask;
  float pressEdge = u_pressAmt * pillEdge * 0.2;

  // --- Motion shimmer ---
  // Smooth specular arc during drag. Uses gradual velocity direction
  // (not binary sign()) to avoid flicker on small movements.
  float absVel = abs(u_transitionVel);
  // Threshold: only shimmer above meaningful velocity
  float motionSpeed = smoothstep(80.0, 400.0, absVel);
  // Gradual direction: blends smoothly through zero instead of flipping
  float velDir = clamp(u_transitionVel * 0.003, -1.0, 1.0);
  vec2 motionLight = normalize(vec2(-velDir * 0.8, 0.4));
  float motionDot = dot(normalize(pFromPill + vec2(0.001)), motionLight) * 0.5 + 0.5;
  // Broad highlight sweep
  float motionHighlight = pow(motionDot, 3.0) * motionSpeed * 0.15 * pillMask;
  // Tight specular streak
  float motionStreak = pow(motionDot, 12.0) * motionSpeed * 0.2 * pillMask;

  // Enhanced chromatic during motion
  float motionChrom = motionSpeed * chromStrength * 0.7;
  color.r += motionChrom * pFromPill.x * 0.12;
  color.b -= motionChrom * pFromPill.x * 0.12;

  // --- Compose ---
  float alpha = 0.0;

  // Nav
  alpha += navEdge * navTopWeight * 0.22;
  alpha += navSpec * navMask;

  // Pill
  alpha += pillMask * 0.025;
  alpha += pillEdge * pillTopWeight * 0.35;
  alpha += pillSpec * pillMask;
  alpha += lensCenter;

  // Press
  alpha += pressGlow;
  alpha += pressEdge;

  // Motion shimmer
  alpha += motionHighlight;
  alpha += motionStreak;

  alpha *= navMask;
  alpha = clamp(alpha, 0.0, 0.6);

  gl_FragColor = vec4(color * alpha, alpha);
}
`;
const UNIFORM_NAMES = [
    'u_resolution',
    'u_lightPos',
    'u_pillX',
    'u_pillWidth',
    'u_pillHeight',
    'u_navRadius',
    'u_transitionVel',
    'u_pressAmt',
    'u_tintColor'
];
const MAX_DPR = 2;
class LiquidGlassRenderer {
    onInvalidate;
    gl;
    canvas;
    program = null;
    vertexShader = null;
    fragmentShader = null;
    buffer = null;
    uniforms = {};
    contextLost = false;
    cssWidth = 0;
    cssHeight = 0;
    appliedDpr;
    dprQuery = null;
    constructor(canvas, onInvalidate = ()=>{}){
        this.onInvalidate = onInvalidate;
        const gl = canvas.getContext('webgl', {
            premultipliedAlpha: true,
            alpha: true,
            antialias: true
        });
        if (!gl) throw new Error('WebGL not supported');
        this.gl = gl;
        this.canvas = canvas;
        this.appliedDpr = this.dpr();
        this.build();
        canvas.addEventListener('webglcontextlost', this.onContextLost);
        canvas.addEventListener('webglcontextrestored', this.onContextRestored);
        this.watchDpr();
    }
    resize(width, height) {
        this.cssWidth = width;
        this.cssHeight = height;
        if (this.contextLost) return;
        this.applySize();
    }
    render(params) {
        if (this.contextLost || !this.program) return;
        const { gl, uniforms } = this;
        const dpr = this.appliedDpr;
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uniforms.u_resolution, gl.canvas.width, gl.canvas.height);
        gl.uniform2f(uniforms.u_lightPos, params.lightPos[0], params.lightPos[1]);
        gl.uniform1f(uniforms.u_pillX, params.pillX * dpr);
        gl.uniform1f(uniforms.u_pillWidth, params.pillWidth * dpr);
        gl.uniform1f(uniforms.u_pillHeight, params.pillHeight * dpr);
        gl.uniform1f(uniforms.u_navRadius, params.navRadius * dpr);
        gl.uniform1f(uniforms.u_transitionVel, params.transitionVel);
        gl.uniform1f(uniforms.u_pressAmt, params.pressAmt);
        gl.uniform3f(uniforms.u_tintColor, params.tintColor[0], params.tintColor[1], params.tintColor[2]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    destroy() {
        const { gl, canvas } = this;
        canvas.removeEventListener('webglcontextlost', this.onContextLost);
        canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
        this.dprQuery?.removeEventListener('change', this.onDprChange);
        this.dprQuery = null;
        gl.deleteProgram(this.program);
        gl.deleteShader(this.vertexShader);
        gl.deleteShader(this.fragmentShader);
        gl.deleteBuffer(this.buffer);
        this.program = null;
        this.vertexShader = null;
        this.fragmentShader = null;
        this.buffer = null;
        this.uniforms = {};
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    build() {
        const { gl } = this;
        const vs = this.compile(gl.VERTEX_SHADER, vertexSource);
        const fs = this.compile(gl.FRAGMENT_SHADER, fragmentSource);
        this.vertexShader = vs;
        this.fragmentShader = fs;
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error('Link failed: ' + info);
        }
        this.program = program;
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1,
            -1,
            1,
            -1,
            -1,
            1,
            -1,
            1,
            1,
            -1,
            1,
            1
        ]), gl.STATIC_DRAW);
        this.buffer = buf;
        const aPos = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        this.uniforms = {};
        for (const name of UNIFORM_NAMES){
            this.uniforms[name] = gl.getUniformLocation(program, name);
        }
        gl.useProgram(program);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
    }
    onContextLost = (e)=>{
        e.preventDefault();
        this.contextLost = true;
        this.program = null;
        this.vertexShader = null;
        this.fragmentShader = null;
        this.buffer = null;
        this.uniforms = {};
    };
    onContextRestored = ()=>{
        try {
            this.build();
        } catch  {
            return;
        }
        this.contextLost = false;
        this.applySize();
        this.onInvalidate();
    };
    dpr() {
        return Math.min(window.devicePixelRatio || 1, MAX_DPR);
    }
    applySize() {
        const { canvas } = this;
        const dpr = this.dpr();
        this.appliedDpr = dpr;
        if (this.cssWidth > 0 && this.cssHeight > 0) {
            canvas.width = Math.round(this.cssWidth * dpr);
            canvas.height = Math.round(this.cssHeight * dpr);
        }
        this.gl.viewport(0, 0, canvas.width, canvas.height);
    }
    watchDpr() {
        this.dprQuery?.removeEventListener('change', this.onDprChange);
        const dpr = window.devicePixelRatio || 1;
        const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
        query.addEventListener('change', this.onDprChange);
        this.dprQuery = query;
    }
    onDprChange = ()=>{
        this.watchDpr();
        if (this.contextLost) return;
        if (this.dpr() === this.appliedDpr) return;
        this.applySize();
        this.onInvalidate();
    };
    compile(type, source) {
        const { gl } = this;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Shader compile: ' + info);
        }
        return shader;
    }
}

window.LiquidGlassRenderer = LiquidGlassRenderer;
})();
