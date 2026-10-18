// Образец композиции для модели и для проверок рендера.
//
// Модель пишет код заметно лучше, когда видит рабочий пример приёмов в нужном
// контракте: сцены отдельными контейнерами, заголовок по словам из-под маски,
// каскад карточек, счётчик, склейка на ходу в одном направлении. Текст и
// цвета здесь условные — пример показывает приёмы, а не содержание.

const EXAMPLE = String.raw`<style>
  .bg{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 30%, color-mix(in srgb, var(--c2, #5b5bf0) 18%, #0b0b12) 0%, #07070b 70%)}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:72px 72px}
  .scene{position:absolute;inset:0;padding:0 80px;display:flex;flex-direction:column;justify-content:center;visibility:hidden}
  .tag{align-self:flex-start;font:600 30px/1 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:#fff;background:var(--c2,#5b5bf0);padding:16px 26px;border-radius:999px}
  .h1{font:800 132px/0.98 var(--font-heading);color:#fff;letter-spacing:-.02em;margin-top:40px}
  .line{display:block;overflow:hidden;padding-bottom:.08em}
  .w{display:inline-block;margin-right:.22em}
  .accent{color:var(--c2,#5b5bf0)}
  .big{font:800 340px/0.85 var(--font-heading);color:#fff;letter-spacing:-.04em}
  .cap{font:700 30px/1.2 var(--font-body);letter-spacing:.14em;text-transform:uppercase;color:var(--c2,#7c7cff)}
  .row{display:flex;gap:28px;margin-top:70px}
  .card{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:28px;padding:34px 30px;color:#fff;font:700 40px/1.15 var(--font-heading)}
  .card small{display:block;margin-top:14px;font:500 28px/1.2 var(--font-body);color:rgba(255,255,255,.6)}
  .item{position:relative;display:flex;align-items:center;gap:30px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:26px;padding:34px 36px;margin-top:26px;color:#fff;font:700 48px/1.1 var(--font-heading);overflow:hidden}
  .item svg{flex:0 0 64px;position:relative}
  .item span{position:relative}
  .item .hl{position:absolute;inset:0;background:var(--c2,#5b5bf0);opacity:0}
  .price{background:#fff;border-radius:40px;padding:56px 60px;margin-top:40px;position:relative;overflow:hidden}
  .price .from{font:700 32px/1 var(--font-body);color:#6b6b80;letter-spacing:.1em;text-transform:uppercase}
  .price .sum{font:800 168px/0.95 var(--font-heading);color:var(--c2,#4646e0);margin-top:18px;letter-spacing:-.03em}
  .shine{position:absolute;top:-20%;bottom:-20%;width:180px;left:-260px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.85),transparent);transform:skewX(-18deg)}
  .phone{margin-top:56px;background:#fff;color:#0b0b12;border-radius:32px;padding:40px 46px;font:800 76px/1 var(--font-heading)}
  .site{margin-top:26px;align-self:flex-start;font:600 34px/1 var(--font-body);color:#fff;background:rgba(255,255,255,.1);padding:18px 28px;border-radius:999px}
</style>
<div class="bg"></div><div class="grid"></div>
<section class="scene s1">
  <div class="tag">Новый посёлок</div>
  <div class="h1"><span class="line"><span class="w">Устали</span><span class="w">от</span></span><span class="line"><span class="w">квартиры?</span></span><span class="line accent"><span class="w">Своё</span><span class="w">место</span><span class="w">есть.</span></span></div>
</section>
<section class="scene s2">
  <div class="cap">В продаже</div>
  <div class="big"><span class="count">0</span></div>
  <div class="h1" style="font-size:96px;margin-top:10px">домов</div>
  <div class="row"><div class="card">60 м²<small>для двоих</small></div><div class="card">85 м²<small>семья</small></div><div class="card">100 м²<small>с запасом</small></div></div>
</section>
<section class="scene s3">
  <div class="cap">Стена в разрезе</div>
  <div class="item"><i class="hl"></i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg><span>Газобетон</span></div>
  <div class="item"><i class="hl"></i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 20h16M6 20V9l6-5 6 5v11"/></svg><span>Предчистовая отделка</span></div>
  <div class="item"><i class="hl"></i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 7h8v5H3zM13 7h8v5h-8zM8 12h8v5H8z"/></svg><span>Кирпич или сайдинг</span></div>
</section>
<section class="scene s4">
  <div class="tag" style="background:rgba(255,255,255,.12)">Участки от 6 до 8 соток</div>
  <div class="price"><div class="from">Дома от</div><div class="sum">7,4 млн ₽</div><div class="shine"></div></div>
</section>
<section class="scene s5">
  <div class="h1" style="font-size:110px">Запишитесь<br>на показ</div>
  <div class="phone">+7 950 000-00-00</div>
  <div class="site">example.ru</div>
</section>
<script>
  // Сцена приходит справа уже в движении и уходит влево с разгоном: одно
  // направление на весь ролик, склейка на скорости.
  const IN = { x: 260, autoAlpha: 0, duration: 0.5, ease: "power4.out" };
  const OUT = { x: -260, autoAlpha: 0, duration: 0.42, ease: "power4.in" };
  function enter(sel, at) { tl.set(sel, { visibility: "visible" }, at); tl.from(sel, IN, at); }
  function leave(sel, at) { tl.to(sel, OUT, at); tl.set(sel, { visibility: "hidden" }, at + OUT.duration); }

  // 1. Хук: метка, затем слова из-под маски строками.
  tl.set(".s1", { visibility: "visible" }, 0);
  tl.from(".s1 .tag", { y: 40, autoAlpha: 0, duration: 0.5, ease: "back.out(1.6)" }, 0.1);
  tl.from(".s1 .w", { yPercent: 110, duration: 0.6, ease: "expo.out", stagger: 0.06 }, 0.25);
  leave(".s1", 2.6);

  // 2. Цифра считается, после короткой паузы — карточки каскадом.
  enter(".s2", 2.9);
  const c = { v: 0 };
  tl.to(c, { v: 18, duration: 1.1, ease: "power2.out", onUpdate: () => (document.querySelector(".s2 .count").textContent = Math.round(c.v)) }, 3.1);
  tl.from(".s2 .card", { y: 90, autoAlpha: 0, duration: 0.55, ease: "back.out(1.5)", stagger: 0.09 }, 4.4);
  leave(".s2", 6.2);

  // 3. Список: строки прилетают, затем подсветка шагает по ним — сцена живёт до ухода.
  enter(".s3", 6.5);
  tl.from(".s3 .item", { x: 120, autoAlpha: 0, duration: 0.5, ease: "power3.out", stagger: 0.1 }, 6.7);
  // Подсветка — прозрачностью подложки: она перематывается и вперёд, и назад.
  document.querySelectorAll(".s3 .hl").forEach((hl, i) => {
    tl.to(hl, { opacity: 1, duration: 0.25, ease: "power2.out" }, 7.6 + i * 0.6);
    if (i < 2) tl.to(hl, { opacity: 0, duration: 0.25, ease: "power2.in" }, 8.2 + i * 0.6);
  });
  leave(".s3", 9.6);

  // 4. Цена: пауза перед кульминацией, затем блик.
  enter(".s4", 9.9);
  tl.from(".s4 .price", { scale: 0.9, autoAlpha: 0, duration: 0.6, ease: "back.out(1.4)" }, 10.3);
  tl.to(".s4 .shine", { left: "120%", duration: 0.8, ease: "power2.inOut" }, 11.1);
  leave(".s4", 12.6);

  // 5. Финал вверх — вывод поднимается над предыдущим.
  tl.set(".s5", { visibility: "visible" }, 12.9);
  tl.from(".s5 .h1", { y: 160, autoAlpha: 0, duration: 0.6, ease: "power4.out" }, 12.9);
  tl.from([".s5 .phone", ".s5 .site"], { y: 80, autoAlpha: 0, duration: 0.5, ease: "back.out(1.5)", stagger: 0.12 }, 13.3);
  tl.to({}, { duration: 1.8 }, 14.2);
</script>`;

module.exports = { EXAMPLE };
