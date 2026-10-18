// Заготовки титров — анимированные композиции на том же движке, что и
// ИИ-моушн: HTML, CSS и GSAP на шкале `tl`. Прозрачный фон: титр ложится
// слоем поверх видео.
//
// Каждая заготовка берёт цвета и шрифты из дизайн-системы проекта (через
// переменные --c1…, --font-heading), поэтому выглядит фирменно без ручной
// настройки. Поля — только текст: всё остальное (раскладку, движение, тайминг)
// заготовка решает сама.
//
// Движение — по доктрине: появление ≤ 0.8 с каскадом, маски на строках,
// back.out для плашек, уход быстрее появления, без покачиваний на месте.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Слова в span; *слово* — акцентное. */
function words(text, cls = "w") {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const acc = /^\*.*\*$/.test(w);
      const clean = acc ? w.slice(1, -1) : w;
      return `<span class="${cls}${acc ? " acc" : ""}">${esc(clean)}</span>`;
    })
    .join(" ");
}

/** Строки (через «/» или перенос) с масками — заголовок выезжает построчно. */
function lines(text) {
  return String(text || "")
    .split(/\s*(?:\/|\n)\s*/)
    .filter(Boolean)
    .map((l) => `<span class="ln"><span class="li">${words(l)}</span></span>`)
    .join("");
}

/** Общий стиль: акцент, «бумага», «чернила», шрифты — из темы. */
function base(theme) {
  return `
  :root{--acc:${theme.accent};--acc2:${theme.accent2};--ink:${theme.ink};--paper:${theme.paper};--dark:${theme.dark}}
  .wrap{position:absolute;inset:0}
  .ln{display:block;overflow:hidden;padding:0 .04em .06em}
  .li{display:inline-block}
  .w{display:inline-block}
  .acc{color:var(--acc);font-family:var(--font-accent,inherit)}
  ${theme.accentScript ? ".acc{text-transform:none;font-weight:400;font-size:1.12em;letter-spacing:0}" : ""}
  .shadow{filter:drop-shadow(0 10px 30px rgba(0,0,0,.35))}`;
}

function relLum(hex) {
  const m = String(hex || "").match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(hex) {
  const m = String(hex || "").match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

/** Тема заготовок из палитры: самый насыщенный цвет — акцент, светлый — бумага, тёмный — фон. */
function templateTheme(colours = [], fallbackAccent = "#FFD400") {
  const list = colours.filter((c) => /^#[0-9a-f]{6}/i.test(c)).map((c) => c.slice(0, 7));
  const bySat = [...list].sort((a, b) => saturation(b) - saturation(a));
  const accent = bySat[0] && saturation(bySat[0]) > 0.25 ? bySat[0] : fallbackAccent;
  const accent2 = bySat.find((c) => c !== accent && saturation(c) > 0.25) || accent;
  const byLum = [...list].sort((a, b) => relLum(a) - relLum(b));
  const dark = byLum[0] && relLum(byLum[0]) < 0.08 ? byLum[0] : "#0B0B12";
  const paper = byLum[byLum.length - 1] && relLum(byLum[byLum.length - 1]) > 0.8 ? byLum[byLum.length - 1] : "#FFFFFF";
  return { accent, accent2, dark, paper, ink: relLum(accent) > 0.45 ? dark : "#FFFFFF" };
}

const T = [];
const def = (o) => T.push(o);

def({
  id: "headline-slam",
  name: "Заголовок ударом",
  group: "Заголовки",
  duration: 3.6,
  fields: [{ key: "title", label: "Заголовок (/ — новая строка, *слово* — акцент)", value: "Три ошибки / которые *сливают* бюджет" }],
  html: (f, th) => `<style>${base(th)}
  .h{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%);text-align:center;font:800 118px/1 var(--font-heading);color:#fff;letter-spacing:-.02em;text-transform:uppercase;text-shadow:0 8px 40px rgba(0,0,0,.45)}
  .bar{display:block;width:46%;height:16px;margin:34px auto 0;background:var(--acc);border-radius:8px;transform-origin:0 50%}
  </style>
  <div class="wrap"><div class="h">${lines(f.title)}<i class="bar"></i></div></div>
  <script>
  tl.set(".bar", { scaleX: 0 }, 0);
  tl.from(".w", { scale: 2.4, autoAlpha: 0, filter: "blur(18px)", duration: 0.5, ease: "expo.out", stagger: 0.07 }, 0.05);
  tl.to(".bar", { scaleX: 1, duration: 0.55, ease: "power4.out" }, 0.45);
  tl.to(".h", { yPercent: -90, autoAlpha: 0, duration: 0.38, ease: "power4.in" }, 3.2);
  </script>`,
});

def({
  id: "hook-card",
  name: "Хук-карточка",
  group: "Заголовки",
  duration: 4,
  fields: [
    { key: "tag", label: "Метка", value: "Важно" },
    { key: "title", label: "Хук (*слово* — маркер)", value: "Вы теряете *30%* клиентов на первом звонке" },
  ],
  html: (f, th) => `<style>${base(th)}
  .card{position:absolute;left:7%;right:7%;top:12%;padding:46px 50px 54px;border-radius:40px;background:rgba(14,14,20,.62);backdrop-filter:blur(22px);border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 80px rgba(0,0,0,.35)}
  .tag{display:inline-block;font:700 28px/1 var(--font-body);letter-spacing:.14em;text-transform:uppercase;color:var(--ink);background:var(--acc);padding:14px 22px;border-radius:999px}
  .t{margin-top:28px;font:800 78px/1.05 var(--font-heading);color:#fff;letter-spacing:-.01em}
  .t .w{margin-right:.2em;position:relative}
  .t .acc{color:var(--ink);z-index:0}
  .t .acc::before{content:"";position:absolute;left:-.12em;right:-.12em;top:.08em;bottom:.02em;background:var(--acc);border-radius:.18em;z-index:-1;transform:scaleX(var(--m,0));transform-origin:0 50%}
  </style>
  <div class="wrap"><div class="card"><span class="tag">${esc(f.tag)}</span><div class="t">${words(f.title)}</div></div></div>
  <script>
  tl.from(".card", { y: -60, autoAlpha: 0, scale: 0.94, duration: 0.6, ease: "back.out(1.5)" }, 0);
  tl.from(".tag", { x: -30, autoAlpha: 0, duration: 0.4, ease: "power3.out" }, 0.25);
  tl.from(".t .w", { y: 40, autoAlpha: 0, duration: 0.45, ease: "power3.out", stagger: 0.05 }, 0.35);
  tl.to(".t .acc", { "--m": 1, duration: 0.5, ease: "power3.inOut", stagger: 0.12 }, 1.1);
  tl.to(".card", { y: -80, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 3.6);
  </script>`,
});

def({
  id: "lower-third",
  name: "Подпись: имя и должность",
  group: "Подписи",
  duration: 4.5,
  fields: [
    { key: "name", label: "Имя", value: "Анна Смирнова" },
    { key: "role", label: "Должность", value: "основатель студии" },
  ],
  html: (f, th) => `<style>${base(th)}
  .lt{position:absolute;left:7%;bottom:20%;display:flex;align-items:stretch;gap:22px}
  .bar{width:12px;border-radius:6px;background:var(--acc);transform-origin:50% 100%}
  .box{display:flex;flex-direction:column;gap:12px}
  .name{font:800 66px/1 var(--font-heading);color:#fff;text-shadow:0 6px 24px rgba(0,0,0,.5)}
  .role{align-self:flex-start;font:600 32px/1 var(--font-body);color:var(--ink);background:var(--acc);padding:12px 18px;border-radius:12px;letter-spacing:.02em}
  </style>
  <div class="wrap"><div class="lt"><div class="bar"></div><div class="box"><span class="ln"><span class="li name">${esc(f.name)}</span></span><span class="ln"><span class="li role">${esc(f.role)}</span></span></div></div></div>
  <script>
  tl.from(".bar", { scaleY: 0, duration: 0.45, ease: "power4.out" }, 0);
  tl.from(".li", { yPercent: 115, duration: 0.55, ease: "expo.out", stagger: 0.1 }, 0.15);
  tl.to(".li", { yPercent: -115, duration: 0.35, ease: "power4.in", stagger: 0.05 }, 4.0);
  tl.to(".bar", { scaleY: 0, transformOrigin: "50% 0%", duration: 0.3, ease: "power4.in" }, 4.15);
  </script>`,
});

def({
  id: "big-stat",
  name: "Крупная цифра",
  group: "Цифры",
  duration: 4,
  fields: [
    { key: "value", label: "Число", value: "200" },
    { key: "suffix", label: "После числа", value: "+" },
    { key: "label", label: "Подпись", value: "построенных домов" },
  ],
  html: (f, th) => `<style>${base(th)}
  .st{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%);text-align:center}
  .ring{position:absolute;left:50%;top:50%;width:620px;height:620px;margin:-310px 0 0 -310px}
  .num{position:relative;font:800 250px/0.9 var(--font-heading);color:#fff;letter-spacing:-.04em;text-shadow:0 10px 50px rgba(0,0,0,.45)}
  .num i{font-style:normal;color:var(--acc)}
  .lab{position:relative;margin-top:22px;font:700 44px/1.1 var(--font-body);color:#fff;text-transform:uppercase;letter-spacing:.08em;text-shadow:0 4px 20px rgba(0,0,0,.5)}
  </style>
  <div class="wrap"><svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.6"/><circle class="arc" cx="50" cy="50" r="46" fill="none" stroke="var(--acc)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="289" transform="rotate(-90 50 50)"/></svg>
  <div class="st"><div class="num"><span class="n">0</span><i>${esc(f.suffix)}</i></div><div class="lab">${esc(f.label)}</div></div></div>
  <script>
  const target = parseFloat(String(${JSON.stringify(String(f.value))}).replace(/\\s/g, "").replace(",", ".")) || 0;
  const dec = (String(${JSON.stringify(String(f.value))}).split(/[.,]/)[1] || "").length;
  const o = { v: 0 }, n = document.querySelector(".n");
  tl.from(".st", { scale: 0.86, autoAlpha: 0, duration: 0.5, ease: "back.out(1.6)" }, 0);
  tl.to(o, { v: target, duration: 1.4, ease: "power3.out", onUpdate: () => (n.textContent = o.v.toLocaleString("ru-RU", { minimumFractionDigits: dec, maximumFractionDigits: dec })) }, 0.15);
  tl.to(".arc", { strokeDashoffset: 0, duration: 1.4, ease: "power3.out" }, 0.15);
  tl.from(".lab", { y: 30, autoAlpha: 0, duration: 0.45, ease: "power3.out" }, 0.9);
  tl.to(".wrap", { scale: 1.12, autoAlpha: 0, duration: 0.38, ease: "power4.in" }, 3.6);
  </script>`,
});

def({
  id: "list-check",
  name: "Список с галочками",
  group: "Списки",
  duration: 4.6,
  fields: [
    { key: "title", label: "Заголовок", value: "Что входит" },
    { key: "a", label: "Пункт 1", value: "Проект дома" },
    { key: "b", label: "Пункт 2", value: "Фундамент и коробка" },
    { key: "c", label: "Пункт 3", value: "Отделка под ключ" },
  ],
  html: (f, th) => `<style>${base(th)}
  .ls{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%)}
  .tt{font:800 72px/1 var(--font-heading);color:#fff;margin-bottom:34px;text-shadow:0 6px 30px rgba(0,0,0,.45)}
  .it{display:flex;align-items:center;gap:28px;padding:30px 34px;margin-top:20px;border-radius:28px;background:rgba(12,12,18,.66);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.12);font:700 50px/1.1 var(--font-heading);color:#fff}
  .ck{flex:0 0 74px;height:74px}
  .ck circle{fill:var(--acc)} .ck path{fill:none;stroke:var(--ink);stroke-width:4.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40}
  </style>
  <div class="wrap"><div class="ls"><div class="ln"><div class="li tt">${esc(f.title)}</div></div>
  ${[f.a, f.b, f.c].filter(Boolean).map((x) => `<div class="it"><svg class="ck" viewBox="0 0 48 48"><circle cx="24" cy="24" r="24"/><path d="M14 25l7 7 13-15"/></svg><span>${esc(x)}</span></div>`).join("")}</div></div>
  <script>
  tl.from(".tt", { yPercent: 110, duration: 0.55, ease: "expo.out" }, 0);
  document.querySelectorAll(".it").forEach((it, i) => {
    const at = 0.35 + i * 0.32;
    tl.from(it, { x: 140, autoAlpha: 0, duration: 0.5, ease: "power3.out" }, at);
    tl.from(it.querySelector("circle"), { scale: 0, transformOrigin: "50% 50%", duration: 0.4, ease: "back.out(2)" }, at + 0.2);
    tl.to(it.querySelector("path"), { strokeDashoffset: 0, duration: 0.35, ease: "power2.out" }, at + 0.35);
  });
  tl.to(".ls", { x: -220, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 4.2);
  </script>`,
});

def({
  id: "price-tag",
  name: "Ценник",
  group: "Цифры",
  duration: 4,
  fields: [
    { key: "pill", label: "Над ценой", value: "Участки от 6 до 8 соток" },
    { key: "from", label: "Подпись цены", value: "Дома от" },
    { key: "price", label: "Цена", value: "7,4 млн ₽" },
  ],
  html: (f, th) => `<style>${base(th)}
  .pt{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%)}
  .pill{display:inline-block;font:700 32px/1 var(--font-body);color:#fff;background:rgba(20,20,28,.7);border:1px solid rgba(255,255,255,.18);padding:16px 26px;border-radius:999px;backdrop-filter:blur(12px)}
  .card{position:relative;overflow:hidden;margin-top:26px;background:var(--paper);border-radius:40px;padding:50px 56px;box-shadow:0 30px 80px rgba(0,0,0,.35)}
  .fr{font:700 32px/1 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:#7a7a8c}
  .pr{margin-top:16px;font:800 150px/0.95 var(--font-heading);color:var(--acc);letter-spacing:-.03em;white-space:nowrap}
  .sh{position:absolute;top:-30%;bottom:-30%;width:200px;left:-300px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.9),transparent);transform:skewX(-18deg)}
  </style>
  <div class="wrap"><div class="pt"><span class="pill">${esc(f.pill)}</span><div class="card"><div class="fr">${esc(f.from)}</div><div class="pr">${esc(f.price)}</div><div class="sh"></div></div></div></div>
  <script>
  const pr = document.querySelector(".pr"), card = document.querySelector(".card");
  const k = Math.min(1, (card.clientWidth - 112) / pr.scrollWidth); if (k < 1) pr.style.fontSize = (150 * k) + "px";
  tl.from(".pill", { y: 30, autoAlpha: 0, duration: 0.4, ease: "power3.out" }, 0);
  tl.from(".card", { scale: 0.86, autoAlpha: 0, duration: 0.6, ease: "back.out(1.4)" }, 0.15);
  tl.from(".pr", { y: 60, autoAlpha: 0, duration: 0.5, ease: "expo.out" }, 0.75);
  tl.to(".sh", { left: "120%", duration: 0.85, ease: "power2.inOut" }, 1.4);
  tl.to(".pt", { y: -120, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 3.6);
  </script>`,
});

def({
  id: "cta-contacts",
  name: "Призыв и контакты",
  group: "Финал",
  duration: 5,
  fields: [
    { key: "title", label: "Призыв (/ — новая строка)", value: "Запишитесь / на показ" },
    { key: "phone", label: "Телефон", value: "+7 950 000-00-00" },
    { key: "site", label: "Сайт или ник", value: "example.ru" },
  ],
  html: (f, th) => `<style>${base(th)}
  .ct{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%)}
  .tt{font:800 104px/1 var(--font-heading);color:#fff;text-shadow:0 8px 40px rgba(0,0,0,.45)}
  .ph{margin-top:40px;display:flex;align-items:center;gap:22px;background:var(--paper);color:var(--dark);border-radius:30px;padding:34px 38px;font:800 66px/1 var(--font-heading);box-shadow:0 30px 80px rgba(0,0,0,.35)}
  .ph svg{flex:0 0 64px;height:64px}
  .st{display:inline-flex;align-items:center;gap:14px;margin-top:22px;font:600 36px/1 var(--font-body);color:#fff;background:rgba(20,20,28,.7);border:1px solid rgba(255,255,255,.18);padding:18px 28px;border-radius:999px}
  .st b{width:14px;height:14px;border-radius:50%;background:var(--acc)}
  .ring{position:absolute;inset:-10px;border:4px solid var(--acc);border-radius:38px;opacity:0}
  </style>
  <div class="wrap"><div class="ct"><div class="tt">${lines(f.title)}</div>
  <div class="ph" style="position:relative"><svg viewBox="0 0 24 24" fill="none" stroke="var(--acc)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg><span>${esc(f.phone)}</span><i class="ring"></i></div>
  <span class="st"><b></b>${esc(f.site)}</span></div></div>
  <script>
  tl.from(".tt .li", { yPercent: 115, duration: 0.6, ease: "expo.out", stagger: 0.1 }, 0);
  tl.from(".ph", { y: 80, autoAlpha: 0, scale: 0.92, duration: 0.55, ease: "back.out(1.5)" }, 0.55);
  tl.from(".st", { y: 40, autoAlpha: 0, duration: 0.45, ease: "power3.out" }, 0.8);
  tl.fromTo(".ring", { opacity: 0.9, scale: 1 }, { opacity: 0, scale: 1.12, duration: 0.8, ease: "power2.out" }, 1.4);
  tl.to(".ct", { y: -100, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 4.6);
  </script>`,
});

def({
  id: "quote",
  name: "Цитата",
  group: "Текст",
  duration: 5,
  fields: [
    { key: "text", label: "Цитата (/ — новая строка)", value: "Строим так, / как для себя" },
    { key: "author", label: "Автор", value: "Евгений, руководитель" },
  ],
  html: (f, th) => `<style>${base(th)}
  .q{position:absolute;left:8%;right:8%;top:50%;transform:translateY(-50%)}
  .mk{font:800 260px/0.6 Georgia,serif;color:var(--acc);height:150px}
  .tx{font:700 80px/1.08 var(--font-heading);color:#fff;text-shadow:0 8px 40px rgba(0,0,0,.45)}
  .au{margin-top:34px;display:flex;align-items:center;gap:18px;font:600 36px/1 var(--font-body);color:rgba(255,255,255,.85)}
  .au i{width:70px;height:4px;background:var(--acc);border-radius:2px;transform-origin:0 50%}
  </style>
  <div class="wrap"><div class="q"><div class="mk">“</div><div class="tx">${lines(f.text)}</div><div class="au"><i></i>${esc(f.author)}</div></div></div>
  <script>
  tl.from(".mk", { scale: 0.3, autoAlpha: 0, rotation: -12, duration: 0.6, ease: "back.out(1.7)" }, 0);
  tl.from(".tx .li", { yPercent: 110, duration: 0.65, ease: "expo.out", stagger: 0.14 }, 0.25);
  tl.from(".au i", { scaleX: 0, duration: 0.5, ease: "power4.out" }, 0.9);
  tl.from(".au", { x: -30, autoAlpha: 0, duration: 0.45, ease: "power3.out" }, 0.95);
  tl.to(".q", { y: -90, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 4.6);
  </script>`,
});

def({
  id: "chapter",
  name: "Глава / раздел",
  group: "Заголовки",
  duration: 3.4,
  fields: [
    { key: "num", label: "Номер", value: "01" },
    { key: "title", label: "Название", value: "Выбор участка" },
  ],
  html: (f, th) => `<style>${base(th)}
  .ch{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%)}
  .n{font:800 220px/0.85 var(--font-heading);color:transparent;-webkit-text-stroke:3px var(--acc);letter-spacing:-.04em}
  .line{height:6px;background:var(--acc);border-radius:3px;margin:30px 0;transform-origin:0 50%}
  .t{font:800 92px/1 var(--font-heading);color:#fff;text-shadow:0 8px 40px rgba(0,0,0,.45)}
  </style>
  <div class="wrap"><div class="ch"><div class="ln"><div class="li n">${esc(f.num)}</div></div><div class="line"></div><div class="t">${lines(f.title)}</div></div></div>
  <script>
  tl.from(".n", { yPercent: 100, duration: 0.6, ease: "expo.out" }, 0);
  tl.from(".line", { scaleX: 0, duration: 0.6, ease: "power4.inOut" }, 0.2);
  tl.from(".t .li", { yPercent: 115, duration: 0.55, ease: "expo.out", stagger: 0.08 }, 0.5);
  tl.to(".ch", { x: -260, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 3.0);
  </script>`,
});

def({
  id: "steps-progress",
  name: "Шаги процесса",
  group: "Списки",
  duration: 4.4,
  fields: [
    { key: "a", label: "Шаг 1", value: "Источники" },
    { key: "b", label: "Шаг 2", value: "Разработка" },
    { key: "c", label: "Шаг 3", value: "Результат" },
    { key: "title", label: "Текущий шаг — заголовок", value: "Написали код" },
  ],
  html: (f, th) => `<style>${base(th)}
  .sp{position:absolute;left:7%;right:7%;top:14%}
  .rail{position:relative;display:flex;justify-content:space-between;font:600 30px/1 var(--font-body);color:rgba(255,255,255,.55);padding-bottom:26px}
  .rail span.on{color:#fff}
  .tr{position:absolute;left:0;right:0;bottom:0;height:6px;border-radius:3px;background:rgba(255,255,255,.15)}
  .fill{position:absolute;left:0;bottom:0;height:6px;border-radius:3px;background:var(--acc);width:0}
  .dot{position:absolute;bottom:-7px;width:20px;height:20px;border-radius:50%;background:var(--acc);margin-left:-10px;box-shadow:0 0 0 8px color-mix(in srgb, var(--acc) 30%, transparent)}
  .t{margin-top:52px;font:800 84px/1 var(--font-heading);color:#fff;text-shadow:0 8px 40px rgba(0,0,0,.45)}
  </style>
  <div class="wrap"><div class="sp"><div class="rail"><span>${esc(f.a)}</span><span class="on">${esc(f.b)}</span><span>${esc(f.c)}</span><i class="tr"></i><i class="fill"></i><i class="dot"></i></div><div class="t">${lines(f.title)}</div></div></div>
  <script>
  tl.from(".rail span", { y: 20, autoAlpha: 0, duration: 0.4, ease: "power3.out", stagger: 0.08 }, 0);
  tl.from(".tr", { scaleX: 0, transformOrigin: "0 50%", duration: 0.5, ease: "power3.out" }, 0.1);
  tl.set(".dot", { left: "0%" }, 0);
  tl.to(".fill", { width: "50%", duration: 0.9, ease: "power3.inOut" }, 0.5);
  tl.to(".dot", { left: "50%", duration: 0.9, ease: "power3.inOut" }, 0.5);
  tl.from(".dot", { scale: 0, duration: 0.3, ease: "back.out(2)" }, 0.45);
  tl.from(".t .li", { yPercent: 115, duration: 0.55, ease: "expo.out", stagger: 0.08 }, 1.1);
  tl.to(".sp", { x: -220, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 4.0);
  </script>`,
});

def({
  id: "map-pins",
  name: "Карта: что рядом",
  group: "Карточки",
  duration: 5,
  fields: [
    { key: "title", label: "Заголовок", value: "Всё нужное — рядом" },
    { key: "a", label: "Точка 1", value: "Школа · 2,5 км" },
    { key: "b", label: "Точка 2", value: "Аптека · 500 м" },
    { key: "c", label: "Точка 3", value: "Парк · 1,2 км" },
  ],
  html: (f, th) => `<style>${base(th)}
  .mp{position:absolute;left:7%;right:7%;top:16%}
  .t{font:800 76px/1 var(--font-heading);color:#fff;text-transform:uppercase;text-shadow:0 8px 40px rgba(0,0,0,.45)}
  .map{position:relative;margin-top:34px;height:620px;border-radius:36px;overflow:hidden;background:#1d1e24;border:1px solid rgba(255,255,255,.1)}
  .map svg{position:absolute;inset:0;width:100%;height:100%}
  .road{fill:none;stroke:rgba(255,255,255,.18);stroke-width:14;stroke-linecap:round}
  .route{fill:none;stroke:var(--acc);stroke-width:5;stroke-dasharray:8 10;stroke-linecap:round}
  .pin{position:absolute;display:flex;align-items:center;gap:10px;font:700 28px/1 var(--font-body);color:#fff;background:rgba(40,40,52,.92);padding:12px 18px;border-radius:999px;white-space:nowrap;border:1px solid rgba(255,255,255,.14)}
  .pin b{width:14px;height:14px;border-radius:50%;background:var(--acc)}
  .home{position:absolute;left:12%;bottom:14%;width:46px;height:46px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 14px color-mix(in srgb, var(--acc) 30%, transparent)}
  </style>
  <div class="wrap"><div class="mp"><div class="ln"><div class="li t">${esc(f.title)}</div></div>
  <div class="map"><svg viewBox="0 0 900 620" preserveAspectRatio="none"><path class="road" d="M-20 520 L940 380"/><path class="road" d="M180 -20 L320 660"/><path class="road" d="M560 -20 L700 660"/><path class="road" d="M-20 160 L940 60"/><path class="route" d="M130 540 C 260 470, 380 420, 560 300 S 760 140, 820 110"/></svg>
  <i class="home"></i>
  <span class="pin" style="left:44%;top:52%"><b></b>${esc(f.b)}</span>
  <span class="pin" style="left:58%;top:28%"><b></b>${esc(f.c)}</span>
  <span class="pin" style="left:62%;top:9%"><b></b>${esc(f.a)}</span></div></div></div>
  <script>
  const route = document.querySelector(".route"), L = route.getTotalLength();
  tl.set(route, { strokeDasharray: L, strokeDashoffset: L }, 0);
  tl.from(".t", { yPercent: 110, duration: 0.55, ease: "expo.out" }, 0);
  tl.from(".map", { y: 80, autoAlpha: 0, duration: 0.6, ease: "power3.out" }, 0.2);
  tl.from(".road", { autoAlpha: 0, duration: 0.5, stagger: 0.06 }, 0.4);
  tl.from(".home", { scale: 0, duration: 0.45, ease: "back.out(2)" }, 0.7);
  tl.to(route, { strokeDashoffset: 0, duration: 1.6, ease: "power2.inOut" }, 0.9);
  tl.from(".pin", { y: 20, scale: 0.6, autoAlpha: 0, duration: 0.45, ease: "back.out(1.8)", stagger: 0.4 }, 1.1);
  tl.to(".mp", { x: -220, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 4.6);
  </script>`,
});

def({
  id: "compare",
  name: "Было / стало",
  group: "Карточки",
  duration: 4.6,
  fields: [
    { key: "left", label: "Было — заголовок", value: "Было" },
    { key: "lt", label: "Было — текст", value: "3 часа на смету" },
    { key: "right", label: "Стало — заголовок", value: "Стало" },
    { key: "rt", label: "Стало — текст", value: "5 минут" },
  ],
  html: (f, th) => `<style>${base(th)}
  .cp{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%);display:flex;gap:26px;align-items:stretch}
  .c{flex:1;border-radius:34px;padding:40px 34px;min-height:380px;display:flex;flex-direction:column;justify-content:space-between}
  .a{background:rgba(20,20,28,.72);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.75)}
  .b{background:var(--acc);color:var(--ink)}
  .k{font:700 30px/1 var(--font-body);letter-spacing:.12em;text-transform:uppercase}
  .v{font:800 70px/1.02 var(--font-heading)}
  .a .v{text-decoration:line-through;text-decoration-thickness:6px;text-decoration-color:rgba(255,255,255,.4)}
  .vs{position:absolute;left:50%;top:50%;width:110px;height:110px;margin:-55px 0 0 -55px;border-radius:50%;background:var(--paper);color:var(--dark);display:flex;align-items:center;justify-content:center;font:800 40px/1 var(--font-heading);box-shadow:0 20px 50px rgba(0,0,0,.35)}
  </style>
  <div class="wrap"><div class="cp"><div class="c a"><span class="k">${esc(f.left)}</span><span class="v">${esc(f.lt)}</span></div><div class="c b"><span class="k">${esc(f.right)}</span><span class="v">${esc(f.rt)}</span></div><div class="vs">→</div></div></div>
  <script>
  tl.from(".a", { x: -200, autoAlpha: 0, duration: 0.55, ease: "power4.out" }, 0);
  tl.from(".b", { x: 200, autoAlpha: 0, duration: 0.55, ease: "power4.out" }, 0.75);
  tl.from(".vs", { scale: 0, rotation: -90, duration: 0.5, ease: "back.out(1.8)" }, 0.6);
  tl.from(".b .v", { y: 40, autoAlpha: 0, duration: 0.45, ease: "expo.out" }, 1.15);
  tl.to(".cp", { x: -240, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 4.2);
  </script>`,
});

def({
  id: "subscribe",
  name: "Подписка с курсором",
  group: "Финал",
  duration: 4,
  fields: [
    { key: "label", label: "Кнопка", value: "Подписаться" },
    { key: "done", label: "После нажатия", value: "Вы подписаны" },
  ],
  html: (f, th) => `<style>${base(th)}
  .sb{position:absolute;left:50%;top:62%;transform:translate(-50%,-50%)}
  .btn{position:relative;display:flex;align-items:center;gap:20px;background:var(--acc);color:var(--ink);font:800 58px/1 var(--font-heading);padding:34px 54px;border-radius:999px;box-shadow:0 26px 70px rgba(0,0,0,.4);white-space:nowrap}
  .done{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:16px;background:var(--paper);color:var(--dark);border-radius:999px;opacity:0}
  .cur{position:absolute;width:120px;height:120px;left:70%;top:60%}
  </style>
  <div class="wrap"><div class="sb"><div class="btn"><span>${esc(f.label)}</span><div class="done">✓ ${esc(f.done)}</div></div>
  <svg class="cur" viewBox="0 0 24 24"><path d="M4 2l15 10-7 1.5L15 21l-3 1-3-7.5L4 18z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg></div></div>
  <script>
  tl.from(".btn", { scale: 0.6, autoAlpha: 0, duration: 0.5, ease: "back.out(1.7)" }, 0);
  tl.from(".cur", { x: 420, y: 520, duration: 0.8, ease: "power3.out" }, 0.4);
  tl.to(".cur", { scale: 0.82, duration: 0.08, ease: "power2.in" }, 1.25);
  tl.to(".btn", { scale: 0.93, duration: 0.08, ease: "power2.in" }, 1.25);
  tl.to(".cur", { scale: 1, duration: 0.25, ease: "back.out(2)" }, 1.33);
  tl.to(".btn", { scale: 1, duration: 0.35, ease: "back.out(2.4)" }, 1.33);
  tl.to(".done", { opacity: 1, duration: 0.2 }, 1.33);
  tl.to(".cur", { x: 500, y: 300, autoAlpha: 0, duration: 0.6, ease: "power3.in" }, 2.2);
  tl.to(".sb", { y: 120, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 3.6);
  </script>`,
});

def({
  id: "keyword-marker",
  name: "Маркер по словам",
  group: "Текст",
  duration: 4.6,
  fields: [{ key: "text", label: "Фраза (*слово* — выделить)", value: "Главное — *честная* смета и *срок* в договоре" }],
  html: (f, th) => `<style>${base(th)}
  .km{position:absolute;left:8%;right:8%;top:50%;transform:translateY(-50%);font:800 84px/1.12 var(--font-heading);color:#fff;text-shadow:0 8px 40px rgba(0,0,0,.45)}
  .km .w{margin-right:.22em;position:relative;z-index:0}
  .km .acc{color:var(--ink);text-shadow:none}
  .km .acc::before{content:"";position:absolute;left:-.1em;right:-.1em;top:.12em;bottom:0;background:var(--acc);z-index:-1;border-radius:.12em;transform:scaleX(var(--m,0));transform-origin:0 50%}
  </style>
  <div class="wrap"><div class="km">${words(f.text)}</div></div>
  <script>
  tl.from(".km .w", { y: 50, autoAlpha: 0, duration: 0.45, ease: "power3.out", stagger: 0.06 }, 0);
  tl.to(".km .acc", { "--m": 1, duration: 0.45, ease: "power3.inOut", stagger: 0.35 }, 0.9);
  tl.to(".km", { y: -80, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 4.2);
  </script>`,
});

def({
  id: "logo-sting",
  name: "Логотип",
  group: "Финал",
  duration: 3.6,
  fields: [{ key: "tagline", label: "Слоган", value: "Коттеджный посёлок" }],
  needsLogo: true,
  html: (f, th, a) => `<style>${base(th)}
  .lg{position:absolute;left:10%;right:10%;top:50%;transform:translateY(-50%);text-align:center}
  .lg img{max-width:72%;max-height:380px;width:auto;height:auto;object-fit:contain}
  .lg .nm{font:800 120px/1 var(--font-heading);color:#fff}
  .tg{margin-top:36px;font:600 40px/1.1 var(--font-body);color:rgba(255,255,255,.9);letter-spacing:.2em;text-transform:uppercase}
  .tg span{display:inline-block}
  .sw{position:absolute;top:-20%;bottom:-20%;width:240px;left:-40%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg);mix-blend-mode:overlay}
  </style>
  <div class="wrap"><div class="lg">${a.logo ? `<img src="asset://logo" alt="">` : `<div class="nm">${lines(f.tagline)}</div>`}${a.logo ? `<div class="tg">${Array.from(String(f.tagline || "")).map((ch) => `<span>${ch === " " ? "&nbsp;" : esc(ch)}</span>`).join("")}</div>` : ""}<div class="sw"></div></div></div>
  <script>
  tl.from(".lg img, .lg .nm", { scale: 1.35, autoAlpha: 0, filter: "blur(24px)", duration: 0.8, ease: "expo.out" }, 0);
  tl.to(".sw", { left: "120%", duration: 0.9, ease: "power2.inOut" }, 0.6);
  tl.from(".tg span", { y: 30, autoAlpha: 0, duration: 0.35, ease: "power3.out", stagger: 0.025 }, 0.7);
  tl.to(".lg", { scale: 0.9, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 3.2);
  </script>`,
});

def({
  id: "phone-ui",
  name: "Экран телефона",
  group: "Карточки",
  duration: 5,
  fields: [
    { key: "title", label: "Заголовок над телефоном", value: "Считает платёж сразу" },
    { key: "l1", label: "Строка 1", value: "Сумма" },
    { key: "v1", label: "Значение 1", value: "5 405 000 ₽" },
    { key: "l2", label: "Строка 2", value: "Ставка · срок" },
    { key: "v2", label: "Значение 2", value: "6% · 30 лет" },
    { key: "label", label: "Итог", value: "Платёж в месяц" },
    { key: "value", label: "Значение", value: "32 407 ₽" },
  ],
  html: (f, th) => `<style>${base(th)}
  .pu{position:absolute;left:0;right:0;top:12%;text-align:center}
  .t{font:800 72px/1.05 var(--font-heading);color:#fff;padding:0 8%;text-shadow:0 8px 40px rgba(0,0,0,.45)}
  .ph{position:relative;margin:46px auto 0;width:520px;height:900px;border-radius:72px;background:#101116;border:10px solid #2a2b33;box-shadow:0 40px 100px rgba(0,0,0,.5);overflow:hidden;text-align:left}
  .nt{position:absolute;left:50%;top:18px;width:150px;height:34px;margin-left:-75px;border-radius:20px;background:#000}
  .sc{position:absolute;inset:80px 34px 34px}
  .row{background:#1d1e26;border-radius:26px;padding:26px 28px;margin-bottom:18px;color:rgba(255,255,255,.6);font:600 30px/1.2 var(--font-body)}
  .row b{display:block;margin-top:10px;font:800 48px/1 var(--font-heading);color:#fff}
  .row.hl{background:var(--acc);color:var(--ink)} .row.hl b{color:var(--ink);font-size:62px}
  .sl{height:10px;border-radius:5px;background:rgba(255,255,255,.12);margin-top:18px;position:relative}
  .sl i{position:absolute;left:0;top:0;bottom:0;width:20%;border-radius:5px;background:var(--acc)}
  </style>
  <div class="wrap"><div class="pu"><div class="t">${lines(f.title)}</div><div class="ph"><i class="nt"></i><div class="sc">
  <div class="row">${esc(f.l1)}<b>${esc(f.v1)}</b><div class="sl"><i></i></div></div>
  <div class="row">${esc(f.l2)}<b>${esc(f.v2)}</b></div>
  <div class="row hl">${esc(f.label)}<b class="v">${esc(f.value)}</b></div></div></div></div></div>
  <script>
  tl.from(".t .li", { yPercent: 110, duration: 0.55, ease: "expo.out", stagger: 0.08 }, 0);
  tl.from(".ph", { y: 500, duration: 0.8, ease: "power4.out" }, 0.2);
  tl.from(".row", { y: 50, autoAlpha: 0, duration: 0.45, ease: "power3.out", stagger: 0.12 }, 0.8);
  tl.to(".sl i", { width: "68%", duration: 1, ease: "power2.inOut" }, 1.4);
  tl.from(".row.hl", { scale: 0.9, duration: 0.4, ease: "back.out(2)" }, 2.4);
  tl.to(".pu", { y: -200, autoAlpha: 0, duration: 0.45, ease: "power4.in" }, 4.55);
  </script>`,
});

def({
  id: "split-title",
  name: "Заголовок со шторкой",
  group: "Заголовки",
  duration: 3.6,
  fields: [{ key: "title", label: "Заголовок (/ — новая строка)", value: "Сейчас / в продаже" }],
  html: (f, th) => `<style>${base(th)}
  .sp{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%)}
  .row{position:relative;display:table;margin:10px 0;overflow:hidden}
  .row .tx{position:relative;display:block;font:800 112px/1.02 var(--font-heading);color:#fff;padding:6px 24px;background:var(--dark)}
  .row:nth-child(2) .tx{background:var(--acc);color:var(--ink)}
  .row .bl{position:absolute;inset:0;background:var(--paper);transform-origin:0 50%}
  </style>
  <div class="wrap"><div class="sp">${String(f.title || "").split(/\s*(?:\/|\n)\s*/).filter(Boolean).map((l) => `<div class="row"><span class="tx">${esc(l)}</span><i class="bl"></i></div>`).join("")}</div></div>
  <script>
  document.querySelectorAll(".row").forEach((row, i) => {
    const at = i * 0.16;
    const bl = row.querySelector(".bl"), tx = row.querySelector(".tx");
    tl.set(tx, { autoAlpha: 0 }, 0);
    tl.fromTo(bl, { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: 0.35, ease: "power4.in" }, at);
    tl.set(tx, { autoAlpha: 1 }, at + 0.35);
    tl.set(bl, { transformOrigin: "100% 50%" }, at + 0.35);
    tl.to(bl, { scaleX: 0, duration: 0.4, ease: "power4.out" }, at + 0.35);
  });
  tl.to(".sp", { x: -260, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 3.2);
  </script>`,
});

def({
  id: "date-badge",
  name: "Дата события",
  group: "Карточки",
  duration: 4,
  fields: [
    { key: "day", label: "День", value: "24" },
    { key: "month", label: "Месяц", value: "октября" },
    { key: "title", label: "Событие", value: "День открытых дверей" },
  ],
  html: (f, th) => `<style>${base(th)}
  .db{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:40px}
  .cal{flex:0 0 300px;border-radius:40px;overflow:hidden;background:var(--paper);box-shadow:0 30px 80px rgba(0,0,0,.4);text-align:center}
  .cal .m{background:var(--acc);color:var(--ink);font:800 38px/1 var(--font-body);text-transform:uppercase;letter-spacing:.06em;padding:22px 0}
  .cal .d{font:800 170px/1 var(--font-heading);color:var(--dark);padding:24px 0 30px}
  .t{font:800 76px/1.05 var(--font-heading);color:#fff;text-shadow:0 8px 40px rgba(0,0,0,.45)}
  </style>
  <div class="wrap"><div class="db"><div class="cal"><div class="m">${esc(f.month)}</div><div class="d">${esc(f.day)}</div></div><div class="t">${lines(f.title)}</div></div></div>
  <script>
  tl.from(".cal", { rotationX: -90, transformOrigin: "50% 0%", transformPerspective: 900, autoAlpha: 0, duration: 0.7, ease: "back.out(1.4)" }, 0);
  tl.from(".cal .d", { y: 60, autoAlpha: 0, duration: 0.45, ease: "expo.out" }, 0.45);
  tl.from(".t .li", { yPercent: 115, duration: 0.55, ease: "expo.out", stagger: 0.1 }, 0.55);
  tl.to(".db", { x: -240, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 3.6);
  </script>`,
});


// ---------- шрифтовые пары ----------
// Заголовки как в трендовых рилс: плотный крупный шрифт и рукописный или
// курсивный акцент. У каждой заготовки своя пара по умолчанию; в инспекторе
// её можно сменить на любую другую или на шрифты дизайн-системы.

def({
  id: "pair-stack",
  name: "Стопка: мелко + КРУПНО + рукопись",
  group: "Шрифтовые пары",
  pair: "tall",
  duration: 4,
  fields: [
    { key: "top", label: "Сверху мелко", value: "как улучшить" },
    { key: "main", label: "Крупно (/ — строка)", value: "Качество / роликов" },
    { key: "tail", label: "Рукописью", value: "ваших" },
  ],
  html: (f, th) => `<style>${base(th)}
  .st{position:absolute;left:8%;right:8%;top:16%}
  .tp{font:500 50px/1 var(--font-body);color:#fff;letter-spacing:.01em;margin-left:.1em;text-shadow:0 4px 24px rgba(0,0,0,.35)}
  .mn{font:400 230px/.86 var(--font-heading);color:var(--acc);text-transform:uppercase;letter-spacing:-.01em;margin-top:14px;text-shadow:0 10px 50px rgba(0,0,0,.3)}
  .tl{font:400 130px/1 var(--font-accent,var(--font-body));color:#fff;text-align:right;margin-top:-18px;clip-path:inset(-20% 100% -20% 0);text-shadow:0 6px 30px rgba(0,0,0,.35)}
  </style>
  <div class="wrap"><div class="st"><div class="tp">${esc(f.top)}</div><div class="mn">${lines(f.main)}</div><div class="tl">${esc(f.tail)}</div></div></div>
  <script>
  // Крупные строки — на всю ширину колонки: шрифт подгоняется по самой длинной.
  const mn = document.querySelector(".mn"), st = document.querySelector(".st");
  const widest = Math.max(...[...mn.querySelectorAll(".li")].map((e) => e.scrollWidth));
  mn.style.fontSize = Math.round(230 * Math.min(1.9, st.clientWidth / Math.max(1, widest))) + "px";
  tl.from(".tp", { y: 30, autoAlpha: 0, duration: 0.45, ease: "power3.out" }, 0);
  tl.from(".mn .li", { yPercent: 105, duration: 0.6, ease: "expo.out", stagger: 0.1 }, 0.15);
  tl.to(".tl", { clipPath: "inset(-20% 0% -20% 0)", duration: 0.8, ease: "power2.inOut" }, 0.75);
  tl.to(".st", { y: -120, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 3.6);
  </script>`,
});

def({
  id: "pair-overlap",
  name: "КРУПНО + рукопись поверх",
  group: "Шрифтовые пары",
  pair: "reels",
  duration: 4,
  fields: [
    { key: "main", label: "Крупное слово", value: "Шрифтовые" },
    { key: "script", label: "Рукописью поверх", value: "пары" },
    { key: "note", label: "Мелко", value: "для своих видео" },
  ],
  html: (f, th) => `<style>${base(th)}
  .ov{position:absolute;left:6%;right:6%;top:50%;transform:translateY(-50%);text-align:center}
  .mn{font:400 200px/.9 var(--font-heading);color:#fff;text-transform:uppercase;letter-spacing:-.01em;white-space:nowrap;text-shadow:0 10px 50px rgba(0,0,0,.35)}
  .mn .c{display:inline-block}
  .sc{display:inline-block;font:400 210px/1 var(--font-accent,var(--font-heading));color:var(--acc);transform:rotate(-7deg);margin-top:-95px;margin-left:34%;clip-path:inset(-20% 100% -20% 0);text-shadow:0 8px 40px rgba(0,0,0,.35)}
  .nt{font:600 34px/1 var(--font-body);color:#fff;letter-spacing:.18em;text-transform:uppercase;margin-top:10px;opacity:.9}
  </style>
  <div class="wrap"><div class="ov"><div class="mn">${Array.from(String(f.main || "")).map((c) => `<span class="c">${c === " " ? "&nbsp;" : esc(c)}</span>`).join("")}</div><div><span class="sc">${esc(f.script)}</span></div><div class="nt">${esc(f.note)}</div></div></div>
  <script>
  const mn = document.querySelector(".mn"), box = document.querySelector(".ov");
  // Длинное слово не вылезает за кадр: шрифт ужимается под ширину.
  mn.style.fontSize = Math.round(200 * Math.min(1.5, box.clientWidth / mn.scrollWidth)) + "px";
  tl.from(".mn .c", { yPercent: 120, autoAlpha: 0, duration: 0.5, ease: "expo.out", stagger: 0.04 }, 0);
  tl.to(".sc", { clipPath: "inset(-20% 0% -20% 0)", duration: 0.75, ease: "power2.inOut" }, 0.55);
  tl.from(".nt", { y: 20, autoAlpha: 0, duration: 0.4, ease: "power3.out" }, 1.1);
  tl.to(".ov", { scale: 1.08, autoAlpha: 0, duration: 0.4, ease: "power4.in" }, 3.6);
  </script>`,
});

def({
  id: "pair-script-hero",
  name: "Большая рукопись",
  group: "Шрифтовые пары",
  pair: "magazine",
  duration: 4.2,
  fields: [
    { key: "top", label: "Сверху", value: "Как сделать" },
    { key: "script", label: "Рукописью (/ — строка)", value: "новый / формат / рилс" },
  ],
  html: (f, th) => `<style>${base(th)}
  .tp{position:absolute;left:8%;right:8%;top:9%;font:500 84px/1 var(--font-body);color:var(--paper);text-shadow:0 6px 30px rgba(0,0,0,.35)}
  .hr{position:absolute;left:8%;right:8%;bottom:16%;text-align:center}
  .hr .s{display:block;font:400 190px/.95 var(--font-accent,var(--font-heading));color:var(--acc);clip-path:inset(-30% 100% -30% 0);text-shadow:0 8px 40px rgba(0,0,0,.35)}
  </style>
  <div class="wrap"><div class="tp">${esc(f.top)}</div><div class="hr">${String(f.script || "").split(/\s*(?:\/|\n)\s*/).filter(Boolean).map((l) => `<span class="s">${esc(l)}</span>`).join("")}</div></div>
  <script>
  tl.from(".tp", { y: -40, autoAlpha: 0, duration: 0.5, ease: "power3.out" }, 0);
  document.querySelectorAll(".hr .s").forEach((el, i) => tl.to(el, { clipPath: "inset(-30% 0% -30% 0)", duration: 0.7, ease: "power2.inOut" }, 0.3 + i * 0.45));
  tl.to([".tp", ".hr"], { autoAlpha: 0, y: 40, duration: 0.4, ease: "power4.in", stagger: 0.05 }, 3.75);
  </script>`,
});

def({
  id: "pair-cinema",
  name: "Кинотитр",
  group: "Шрифтовые пары",
  pair: "cinema",
  duration: 4.5,
  fields: [
    { key: "title", label: "Название", value: "Тихий вечер" },
    { key: "sub", label: "Подзаголовок", value: "история одного дома" },
  ],
  html: (f, th) => `<style>${base(th)}
  .cn{position:absolute;left:5%;right:5%;top:50%;transform:translateY(-50%);text-align:center}
  .t{font:400 120px/1.05 var(--font-heading);color:#f4ecd8;text-transform:uppercase;letter-spacing:.2em;text-shadow:0 0 40px rgba(0,0,0,.5)}
  .ln2{height:2px;width:56%;margin:26px auto;background:linear-gradient(90deg,transparent,#f4ecd8,transparent);transform:scaleX(0)}
  .s{font:400 64px/1.1 var(--font-accent,var(--font-body));color:#f4ecd8;opacity:.92}
  </style>
  <div class="wrap"><div class="cn"><div class="t">${esc(f.title)}</div><div class="ln2"></div><div class="s">${esc(f.sub)}</div></div></div>
  <script>
  const t = document.querySelector(".t"), cn = document.querySelector(".cn");
  const k = Math.min(1, cn.clientWidth / t.scrollWidth); if (k < 1) t.style.fontSize = (120 * k) + "px";
  tl.fromTo(".t", { letterSpacing: "0.6em", autoAlpha: 0, filter: "blur(14px)" }, { letterSpacing: "0.2em", autoAlpha: 1, filter: "blur(0px)", duration: 1.6, ease: "power2.out" }, 0);
  tl.to(".ln2", { scaleX: 1, duration: 0.9, ease: "power3.inOut" }, 0.9);
  tl.from(".s", { autoAlpha: 0, y: 16, duration: 0.8, ease: "power2.out" }, 1.4);
  tl.to(".cn", { autoAlpha: 0, filter: "blur(10px)", duration: 0.6, ease: "power2.in" }, 3.9);
  </script>`,
});

def({
  id: "pair-neon",
  name: "Неоновая рукопись",
  group: "Шрифтовые пары",
  pair: "neon",
  duration: 4,
  fields: [
    { key: "title", label: "Надпись", value: "Завораживающий звук" },
    { key: "sub", label: "Мелко", value: "для твоих reels" },
  ],
  html: (f, th) => `<style>${base(th)}
  .ne{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%);text-align:center}
  .t{font:400 116px/1.05 var(--font-heading);color:#fff;text-shadow:0 0 8px #fff,0 0 22px var(--acc),0 0 48px var(--acc),0 0 90px var(--acc)}
  .s{margin-top:22px;font:600 40px/1 var(--font-body);color:#fff;letter-spacing:.2em;text-transform:uppercase;text-shadow:0 0 14px var(--acc)}
  </style>
  <div class="wrap"><div class="ne"><div class="t">${esc(f.title)}</div><div class="s">${esc(f.sub)}</div></div></div>
  <script>
  // Неон «загорается» с миганием — по шкале, поэтому каждый кадр одинаков.
  tl.set(".t", { autoAlpha: 0 }, 0);
  [[0.1, 1], [0.16, 0.15], [0.24, 1], [0.3, 0.3], [0.42, 1]].forEach(([at, a]) => tl.set(".t", { autoAlpha: a }, at));
  tl.from(".s", { autoAlpha: 0, y: 14, duration: 0.5, ease: "power2.out" }, 0.7);
  tl.to(".ne", { autoAlpha: 0, duration: 0.35, ease: "power2.in" }, 3.65);
  </script>`,
});

def({
  id: "pair-inline",
  name: "Строка с рукописным словом",
  group: "Шрифтовые пары",
  pair: "minimal",
  duration: 4,
  fields: [
    { key: "l1", label: "Строка 1 (*слово* — рукописью)", value: "Завораживающий звук" },
    { key: "l2", label: "Строка 2", value: "для твоих *reels*" },
  ],
  html: (f, th) => `<style>${base(th)}
  .il{position:absolute;left:7%;right:7%;top:50%;transform:translateY(-50%);text-align:center;color:#fff;text-shadow:0 6px 30px rgba(0,0,0,.4)}
  .a{font:500 96px/1.12 var(--font-heading)}
  .b{font:500 58px/1.2 var(--font-body);margin-top:10px}
  .il .acc{font-size:1.5em;line-height:.8}
  </style>
  <div class="wrap"><div class="il"><div class="a">${words(f.l1)}</div><div class="b">${words(f.l2)}</div></div></div>
  <script>
  tl.from(".il .w:not(.acc)", { y: 30, autoAlpha: 0, duration: 0.45, ease: "power3.out", stagger: 0.06 }, 0);
  tl.from(".il .acc", { autoAlpha: 0, scale: 0.6, rotation: -8, duration: 0.6, ease: "back.out(1.6)", stagger: 0.1 }, 0.5);
  tl.to(".il", { autoAlpha: 0, y: -40, duration: 0.4, ease: "power4.in" }, 3.6);
  </script>`,
});

/** Публичный список: без функций. */
function list() {
  return T.map(({ id, name, group, duration, fields, needsLogo, pair }) => ({ id, name, group, duration, fields, needsLogo: !!needsLogo, pair: pair || "" }));
}

/** Код заготовки с полями и темой. */
/** Пара шрифтов заготовки по умолчанию. */
function defaultPair(id) {
  const t = T.find((x) => x.id === id);
  return (t && t.pair) || "";
}

function build(id, values = {}, theme, assets = {}) {
  const t = T.find((x) => x.id === id);
  if (!t) throw new Error(`Нет такой заготовки: ${id}`);
  const fields = {};
  for (const f of t.fields) fields[f.key] = values[f.key] !== undefined ? values[f.key] : f.value;
  return { html: t.html(fields, theme, assets), duration: t.duration, fields };
}

module.exports = { list, build, defaultPair, templateTheme, words, lines, esc };
