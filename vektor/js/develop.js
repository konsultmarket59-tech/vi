// Обработка фото в духе Lightroom: экспозиция, контраст, света и тени, белые и чёрные,
// баланс белого, сочность, насыщенность, чёткость, удаление дымки, резкость, шумоподавление,
// цвета по каналам (HSL), виньетка, зерно, тонирование; пресеты и пакетная обработка папок.
// Всё считается на видеокарте (WebGL), исходник не меняется до «Применить».
'use strict';

const Develop = {
  DEF: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temp: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, dehaze: 0, sharpen: 0, denoise: 0, vignette: 0, grain: 0, fade: 0, splitH: 30, splitS: 0, splitHs: 220, splitSs: 0, bw: 0,
    hsl: { red: [0, 0, 0], orange: [0, 0, 0], yellow: [0, 0, 0], green: [0, 0, 0], aqua: [0, 0, 0], blue: [0, 0, 0], purple: [0, 0, 0], magenta: [0, 0, 0] } },
  SLIDERS: [
    ['Свет', [['exposure', 'Экспозиция', -3, 3, 0.01], ['contrast', 'Контраст', -100, 100, 1], ['highlights', 'Светлые', -100, 100, 1], ['shadows', 'Тени', -100, 100, 1], ['whites', 'Белые', -100, 100, 1], ['blacks', 'Чёрные', -100, 100, 1], ['fade', 'Матовость', 0, 100, 1]]],
    ['Цвет', [['temp', 'Температура', -100, 100, 1], ['tint', 'Оттенок', -100, 100, 1], ['vibrance', 'Сочность', -100, 100, 1], ['saturation', 'Насыщенность', -100, 100, 1], ['bw', 'Чёрно-белое', 0, 1, 1]]],
    ['Присутствие', [['clarity', 'Чёткость', -100, 100, 1], ['dehaze', 'Удаление дымки', -100, 100, 1]]],
    ['Детали', [['sharpen', 'Резкость', 0, 150, 1], ['denoise', 'Шумоподавление', 0, 100, 1]]],
    ['Эффекты', [['vignette', 'Виньетка', -100, 100, 1], ['grain', 'Зерно', 0, 100, 1]]],
    ['Тонирование', [['splitS', 'Света: насыщенность', 0, 100, 1], ['splitH', 'Света: оттенок', 0, 360, 1], ['splitSs', 'Тени: насыщенность', 0, 100, 1], ['splitHs', 'Тени: оттенок', 0, 360, 1]]],
  ],
  HSL: [['red', 'Красные', 0], ['orange', 'Оранжевые', 30], ['yellow', 'Жёлтые', 60], ['green', 'Зелёные', 120], ['aqua', 'Голубые', 180], ['blue', 'Синие', 240], ['purple', 'Фиолетовые', 280], ['magenta', 'Пурпурные', 320]],
  PRESETS: {
    'Авто': 'auto',
    'Яркий и сочный': { exposure: 0.15, contrast: 18, highlights: -25, shadows: 25, vibrance: 35, saturation: 8, clarity: 15 },
    'Тёплый': { temp: 28, tint: 5, vibrance: 15, highlights: -10, shadows: 10 },
    'Холодный': { temp: -25, tint: -3, contrast: 10, vibrance: 10 },
    'Чёрно-белое': { bw: 1, contrast: 20, clarity: 15, shadows: 10 },
    'Ч/Б контрастное': { bw: 1, contrast: 55, whites: 20, blacks: -30, clarity: 30, grain: 15 },
    'Кино (тил-оранж)': { contrast: 15, highlights: -20, shadows: 15, saturation: -10, splitH: 35, splitS: 25, splitHs: 190, splitSs: 30, fade: 10 },
    'Винтаж': { contrast: -10, fade: 30, temp: 18, saturation: -20, vignette: -30, grain: 25, splitH: 45, splitS: 20 },
    'Матовый': { fade: 35, contrast: -15, highlights: -15, saturation: -10 },
    'Еда': { exposure: 0.1, temp: 15, vibrance: 30, clarity: 20, sharpen: 40, shadows: 15 },
    'Портрет': { exposure: 0.05, clarity: -15, highlights: -15, shadows: 10, vibrance: 10, hsl: { orange: [0, -10, 8], red: [0, -5, 3] } },
    'Пейзаж': { contrast: 15, dehaze: 20, clarity: 25, vibrance: 30, highlights: -30, shadows: 20, hsl: { blue: [-5, 15, -10], green: [10, 10, 0] } },
    'Товар на белом': { exposure: 0.25, whites: 35, highlights: 20, contrast: 10, clarity: 10, sharpen: 50, saturation: 5 },
    'Ночь и неон': { contrast: 25, temp: -15, vibrance: 40, clarity: 20, highlights: -20, hsl: { purple: [0, 25, 0], magenta: [0, 25, 0], blue: [0, 15, 0] } },
  },
  norm(s) { const o = structuredClone(Develop.DEF); if (s && s !== 'auto') { for (const k in s) if (k !== 'hsl') o[k] = s[k]; if (s.hsl) for (const k in s.hsl) o.hsl[k] = s.hsl[k].slice(); } return o; },
  userPresets() { try { return JSON.parse(localStorage.getItem('vektor.devPresets') || '{}'); } catch (e) { return {}; } },
  saveUserPreset(name, s) { const p = Develop.userPresets(); p[name] = s; localStorage.setItem('vektor.devPresets', JSON.stringify(p)); },
  allPresets() { return Object.assign({}, Develop.PRESETS, Develop.userPresets()); },

  // авто: по гистограмме яркости — экспозиция, белые/чёрные, тени/света
  auto(src) {
    const c = document.createElement('canvas'), k = Math.min(1, 400 / Math.max(src.width, src.height));
    c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
    const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height);
    const p = g.getImageData(0, 0, c.width, c.height).data, hist = new Uint32Array(256);
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < p.length; i += 4) { const L = Math.round(p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114); hist[L]++; sr += p[i]; sg += p[i + 1]; sb += p[i + 2]; n++; }
    const pct = q => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * q) return i; } return 255; };
    const lo = pct(0.005), hi = pct(0.995), mid = pct(0.5);
    const s = {};
    s.exposure = G.clamp(Math.log2(118 / Math.max(10, mid)) * 0.6, -1.5, 1.5);
    s.whites = G.clamp((245 - hi) * 0.6, -40, 60); s.blacks = G.clamp((10 - lo) * 1.2, -50, 40);
    s.shadows = mid < 90 ? 25 : 10; s.highlights = hi > 250 ? -25 : -5;
    s.vibrance = 15; s.clarity = 8;
    // баланс белого по среднему (серый мир), мягко
    const ar = sr / n, ag = sg / n, ab = sb / n;
    s.temp = G.clamp((ab - ar) / 2, -40, 40); s.tint = G.clamp((ag - (ar + ab) / 2) / -2, -30, 30);
    for (const k2 in s) s[k2] = Math.round(s[k2] * 100) / 100;
    return s;
  },

  // ---------- WebGL ----------
  FS: `precision highp float; varying vec2 v; uniform sampler2D uS, uB, uB2; uniform vec2 uPx;
    uniform float exposure, contrast, highlights, shadows, whites, blacks, temp, tint, vibrance, saturation, clarity, dehaze, sharpen, denoise, vignette, grain, fade, bw, splitH, splitS, splitHs, splitSs, uAsp, uSeed;
    uniform vec3 hslH[8];
    vec3 toLin(vec3 c){ return pow(max(c,0.0), vec3(2.2)); } vec3 toSrgb(vec3 c){ return pow(max(c,0.0), vec3(1.0/2.2)); }
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x); }
    vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uSeed) * 43758.5453); }
    void main(){
      vec4 s = texture2D(uS, v); vec3 c = s.rgb;
      vec3 b = texture2D(uB, v).rgb, b2 = texture2D(uB2, v).rgb;
      // шумоподавление: подмешиваем мелкое размытие там, где мало деталей
      float edge = length(c - b2) * 4.0; c = mix(c, b2, denoise * 0.01 * (1.0 - clamp(edge, 0.0, 1.0)));
      // резкость (нерезкое маскирование)
      c += (c - b2) * sharpen * 0.02;
      // чёткость: локальный контраст в средних тонах; дымка — то же плюс глубина
      float L0 = lum(c), mid = 1.0 - abs(L0 - 0.5) * 2.0;
      c += (c - b) * (clarity * 0.012 * mid + dehaze * 0.008);
      c = mix(c, (c - 0.08) * 1.1, max(dehaze, 0.0) * 0.004);
      vec3 l = toLin(clamp(c, 0.0, 1.0));
      // баланс белого
      l *= vec3(1.0 + temp * 0.004 + tint * 0.0015, 1.0 - tint * 0.004, 1.0 - temp * 0.004 + tint * 0.0015);
      l *= exp2(exposure);
      c = toSrgb(l);
      // белые и чёрные — концы диапазона
      float bp = -blacks * 0.0012, wp = 1.0 - whites * 0.0025;
      c = (c - bp) / max(wp - bp, 0.05);
      // света и тени
      float L = clamp(lum(c), 0.0, 1.0);
      float hm = smoothstep(0.45, 1.0, L), sm = 1.0 - smoothstep(0.0, 0.55, L);
      c *= 1.0 + (highlights * 0.006 * hm + shadows * 0.008 * sm) * (1.0 / max(L, 0.08)) * 0.35;
      // контраст (S-кривая вокруг середины)
      float k = contrast * 0.01;
      c = mix(c, c * c * (3.0 - 2.0 * c), clamp(k, 0.0, 1.0)); if (k < 0.0) c = mix(c, vec3(0.5) + (c - 0.5) * 0.6, -k);
      // HSL по каналам
      vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
      float deg = hsv.x * 360.0; vec3 adj = vec3(0.0); float wsum = 0.0;
      for (int i = 0; i < 8; i++) {
        float cen = i == 0 ? 0.0 : i == 1 ? 30.0 : i == 2 ? 60.0 : i == 3 ? 120.0 : i == 4 ? 180.0 : i == 5 ? 240.0 : i == 6 ? 280.0 : 320.0;
        float d = abs(mod(deg - cen + 540.0, 360.0) - 180.0); float w = max(0.0, 1.0 - d / 35.0);
        adj += hslH[i] * w; wsum += w;
      }
      hsv.x = fract(hsv.x + adj.x / 360.0 + 1.0); hsv.y = clamp(hsv.y * (1.0 + adj.y * 0.01), 0.0, 1.0);
      c = hsv2rgb(hsv); c *= 1.0 + adj.z * 0.006 * hsv.y;
      // сочность и насыщенность
      float g = lum(c); float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
      c = mix(vec3(g), c, 1.0 + vibrance * 0.01 * (1.0 - sat) + saturation * 0.01);
      if (bw > 0.5) c = vec3(lum(c));
      // тонирование
      float Lt = lum(c);
      vec3 hiC = hsv2rgb(vec3(splitH / 360.0, 1.0, 1.0)), shC = hsv2rgb(vec3(splitHs / 360.0, 1.0, 1.0));
      c = mix(c, c * mix(vec3(1.0), hiC * 1.4, 0.35), splitS * 0.01 * smoothstep(0.35, 1.0, Lt));
      c = mix(c, c + (shC - 0.5) * 0.25, splitSs * 0.01 * (1.0 - smoothstep(0.0, 0.6, Lt)));
      // матовость: подъём чёрного
      c = c * (1.0 - fade * 0.0025) + fade * 0.0025 * 0.9 * (1.0 - c) * 0.5 + fade * 0.0012;
      // виньетка
      vec2 q = (v - 0.5) * vec2(uAsp, 1.0); float r = length(q) / length(vec2(uAsp, 1.0) * 0.5);
      c *= 1.0 + vignette * 0.01 * smoothstep(0.35, 1.05, r);
      // зерно
      c += (hash(v * 1000.0) - 0.5) * grain * 0.0025;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), s.a);
    }`,
  engine() {
    if (Develop._e) return Develop._e;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('Нет WebGL');
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 a; varying vec2 v; void main(){ v = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }'));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, Develop.FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const tex = [0, 1, 2].map(() => gl.createTexture());
    Develop._e = { c, gl, p, tex };
    return Develop._e;
  },
  // исходник (canvas/img) → canvas с обработкой; maxSide — для быстрого просмотра
  render(src, s, { maxSide, target } = {}) {
    s = Develop.norm(s);
    const E = Develop.engine(), gl = E.gl;
    const sw = src.naturalWidth || src.width, shh = src.naturalHeight || src.height;
    const k = maxSide ? Math.min(1, maxSide / Math.max(sw, shh)) : 1;
    const W = Math.max(1, Math.round(sw * k)), H = Math.max(1, Math.round(shh * k));
    const base = document.createElement('canvas'); base.width = W; base.height = H; base.getContext('2d').drawImage(src, 0, 0, W, H);
    const blur = (r) => { const b = document.createElement('canvas'); b.width = W; b.height = H; const g = b.getContext('2d'); g.filter = `blur(${r}px)`; g.drawImage(base, 0, 0); return b; };
    const big = blur(Math.max(2, Math.max(W, H) * 0.015)), small = blur(Math.max(0.8, Math.max(W, H) / 1500));
    E.c.width = W; E.c.height = H;
    gl.viewport(0, 0, W, H); gl.useProgram(E.p);
    [base, big, small].forEach((im, i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, E.tex[i]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      for (const [a, b] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, b);
    });
    const U = n => gl.getUniformLocation(E.p, n);
    gl.uniform1i(U('uS'), 0); gl.uniform1i(U('uB'), 1); gl.uniform1i(U('uB2'), 2);
    gl.uniform2f(U('uPx'), 1 / W, 1 / H); gl.uniform1f(U('uAsp'), W / H); gl.uniform1f(U('uSeed'), 1.7);
    for (const key of Object.keys(Develop.DEF)) if (key !== 'hsl') gl.uniform1f(U(key), +s[key] || 0);
    gl.uniform3fv(U('hslH'), new Float32Array(Develop.HSL.flatMap(([k2]) => s.hsl[k2] || [0, 0, 0])));
    const a = gl.getAttribLocation(E.p, 'a');
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.deleteBuffer(vb);
    const out = target || document.createElement('canvas');
    out.width = W; out.height = H;
    const og = out.getContext('2d'); og.clearRect(0, 0, W, H); og.drawImage(E.c, 0, 0);
    return out;
  },

  // ---------- окно обработки ----------
  // src: canvas/img; done(canvas, settings) — результат в полном размере
  open(src, { title = 'Обработка фото', done, settings } = {}) {
    let s = Develop.norm(settings);
    const prev = h('canvas', { class: 'dv-prev' });
    let showBefore = false;
    const draw = () => {
      cancelAnimationFrame(Develop._raf);
      Develop._raf = requestAnimationFrame(() => {
        if (showBefore) { const k = Math.min(1, 1400 / Math.max(src.width, src.height)); prev.width = Math.round(src.width * k); prev.height = Math.round(src.height * k); prev.getContext('2d').drawImage(src, 0, 0, prev.width, prev.height); }
        else Develop.render(src, s, { maxSide: 1400, target: prev });
      });
    };
    const panel = h('div', { class: 'dv-panel' });
    const sliders = {};
    const build = () => {
      panel.innerHTML = '';
      const pres = h('div', { class: 'dv-presets' });
      for (const [name, val] of Object.entries(Develop.allPresets())) pres.append(h('button', { class: 'pbt', onclick: () => { s = Develop.norm(val === 'auto' ? Develop.auto(src) : val); build(); draw(); } }, name));
      panel.append(h('div', { class: 'mk-st' }, 'Пресеты'), pres);
      for (const [sec, list] of Develop.SLIDERS) {
        panel.append(h('div', { class: 'mk-st' }, sec));
        for (const [k, label, min, max, step] of list) {
          const val = h('span', { class: 'muted' }, String(s[k]));
          const inp = h('input', { type: 'range', min, max, step, value: s[k], oninput: e => { s[k] = +e.target.value; val.textContent = e.target.value; draw(); }, ondblclick: () => { s[k] = Develop.DEF[k]; inp.value = s[k]; val.textContent = s[k]; draw(); } });
          sliders[k] = inp;
          panel.append(h('label', { class: 'mk-sl', title: 'Двойной щелчок — сбросить' }, h('span', {}, label), inp, val));
        }
      }
      panel.append(h('div', { class: 'mk-st' }, 'Цвета по каналам (тон / насыщ. / яркость)'));
      for (const [k, label, hue] of Develop.HSL) {
        const row = h('div', { class: 'dv-hsl' }, h('span', { class: 'dv-dot', style: { background: `hsl(${hue},80%,50%)` } }), h('span', {}, label));
        [0, 1, 2].forEach(j => row.append(h('input', { type: 'range', min: j === 0 ? -30 : -100, max: j === 0 ? 30 : 100, step: 1, value: s.hsl[k][j], title: ['Тон', 'Насыщенность', 'Яркость'][j], oninput: e => { s.hsl[k][j] = +e.target.value; draw(); } })));
        panel.append(row);
      }
      panel.append(h('div', { class: 'row' },
        h('button', { class: 'pbt', onclick: () => { s = Develop.norm(); build(); draw(); } }, 'Сбросить'),
        h('button', { class: 'pbt', onclick: () => UI.prompt('Название пресета', 'Мой пресет', n => { if (n) { Develop.saveUserPreset(n, s); build(); UI.toast('Пресет сохранён'); } }) }, 'Сохранить пресет'),
        h('button', { class: 'pbt', onclick: () => Develop.batch(s) }, 'Пакетно к папке…')));
    };
    build();
    const ba = h('button', { class: 'pbt', onpointerdown: () => { showBefore = true; draw(); }, onpointerup: () => { showBefore = false; draw(); }, onpointerleave: () => { if (showBefore) { showBefore = false; draw(); } } }, 'Удерживать — до');
    const dlg = UI.dialog(title, h('div', { class: 'dv wide-dlg' }, h('div', { class: 'dv-view' }, prev, h('div', { class: 'row dv-bar' }, ba)), panel),
      [{ label: 'Отмена' }, { label: 'Применить', primary: true, action: () => { const out = Develop.render(src, s); done && done(out, s); } }]);
    dlg.classList.add('dv-dialog');
    draw();
  },
  async batch(s) {
    const src = await Host.pickFolder('Папка с фото для обработки');
    if (!src) return;
    const files = src.files.filter(f => /\.(jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return UI.toast('В папке нет фото');
    const out = await Host.pickFolder('Куда сохранить обработанные');
    if (!out) return;
    const q = 0.92;
    await withBusy('Обработка…', async () => {
      for (let i = 0; i < files.length; i++) {
        UI.busy(`Обработка ${i + 1} из ${files.length}: ${files[i].name}`);
        const img = await Polza.loadImage(await Host.blobOf(files[i]));
        const c = Develop.render(img, s);
        const jpg = !/\.png$/i.test(files[i].name);
        const b = await new Promise(r => c.toBlob(r, jpg ? 'image/jpeg' : 'image/png', q));
        await Host.writeToFolder(out, files[i].rel.replace(/\.\w+$/, '') + (jpg ? '.jpg' : '.png'), b);
      }
      UI.toast('Готово: обработано ' + files.length);
    });
  },
};
