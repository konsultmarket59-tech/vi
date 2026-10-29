(function () {
  const bar = document.createElement('div');
  bar.className = 'demobar';
  const roles = { admin: 'Администратор', estimator: 'Сметчик', manager: 'Менеджер', marketer: 'Маркетолог' };
  const cur = (localStorage.getItem('crm-token') || '').replace('demo-', '');
  bar.innerHTML = '<b>Демо CRM</b><span>Данные вымышленные, письма не уходят, правки живут до перезагрузки страницы.</span><span style="flex:1"></span><span>Роль:</span>' +
    Object.entries(roles).map(([k, n]) => `<button data-r="${k}" aria-pressed="${k === cur}">${n}</button>`).join('');
  document.body.prepend(bar);
  bar.querySelectorAll('button').forEach(b => b.onclick = () => { localStorage.setItem('crm-token', 'demo-' + b.dataset.r); location.reload(); });
  const hint = document.createElement('div'); hint.className = 'muted'; hint.style.fontSize = '12.5px';
  hint.innerHTML = 'Демо-входы (пароль <b>demo12345</b>): ' + window.__DEMO_USERS.map(u => u.email).join(', ');
  const lf = document.getElementById('loginForm'); if (lf) lf.after(hint);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/?crm="], a[href^="/?crmp="]');
    if (a) { e.preventDefault(); const t = document.createElement('div'); t.className = 'toast'; t.textContent = 'На сайте эскиз открывается в конструкторе только для просмотра, с рулеткой. В демо эта кнопка не работает.'; document.body.append(t); setTimeout(() => t.remove(), 3500); }
    const h = e.target.closest('a[href="/"], a[href^="/blog/"], a[href^="/uslugi/"], a[href^="/o-nas/"], a[href^="/kontakty/"]'); if (h && !h.closest('.cms-prev')) { e.preventDefault(); const t = document.createElement('div'); t.className = 'toast'; t.textContent = 'В демо страницы сайта открываются через «Предпросмотр»'; document.body.append(t); setTimeout(() => t.remove(), 2500); }
  }, true);
})();
