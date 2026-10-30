import sys, re, json, subprocess
sys.path.insert(0, '/home/user/vi/dom-konstruktor')
import build_single
SP = sys.argv[1]
html = build_single.build()
# демо кабинетов: настоящий market.js и crm-api.js в браузере поверх демо-данных
ROOT = '/home/user/vi/dom-konstruktor'
data = json.load(open(SP + '/demo-data.json'))
import sys as _s; _s.path.insert(0, SP); import demo_content; data = demo_content.add_demo(data)
users = data['users.json']
for u in users:
    u['email'] = u['email'].replace('svoydom.ru', 'logikadoma.ru')
    if u['email'].startswith('petr@'): u['archStatus'] = 'verified'; u['role'] = 'architect'; u['city'] = 'Пермь'; u['about'] = 'Архитектор, 12 лет в частных домах'
anna = next(u for u in users if u['email'].startswith('anna@')); petr = next(u for u in users if u['email'].startswith('petr@'))
for k, v in data.items():
    if k.endswith('project.json'):
        if v['owner'] == anna['id']:
            v['team'] = [{'id': petr['id'], 'email': petr['email'], 'name': petr['name'], 'at': '2026-10-22T10:00:00.000Z'}]
            v['verify'] = {'status': 'verified', 'price': 15000, 'fixed': True, 'requestedAt': '2026-10-20T09:10:00.000Z', 'at': '2026-10-23T12:40:00.000Z', 'note': 'Проверили планировку и конструктив, расширили коридор до 1,2 м.', 'log': []}
        if v['title'].startswith('Мансардный'):
            v['verify'] = {'status': 'requested', 'price': 15000, 'requestedAt': '2026-10-24T08:30:00.000Z', 'log': []}
def wrap(name, f):
    return '<script>window.%s=function(require,module,process,Buffer){\n%s\n};</script>\n' % (name, open(ROOT + '/' + f, encoding='utf-8').read().replace('</script', '<\\/script'))
shim = ('<script>window.__DEMO_DATA=' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + ';</script>\n' + wrap('__CRM_API', 'crm-api.js') + wrap('__MARKET_API', 'market.js') + wrap('__CREDITS', 'credits.js')
        + '<script>' + open(SP + '/site-shim.js', encoding='utf-8').read() + '</script>\n')
social = '<script>window.__SOCIAL=' + json.dumps({'on': True, 'delay': 20, 'title': '', 'text': '', 'links': [{'k': 'vk', 'n': 'ВКонтакте', 'u': 'https://vk.com/'}, {'k': 'telegram', 'n': 'Telegram', 'u': 'https://t.me/'}, {'k': 'youtube', 'n': 'YouTube', 'u': 'https://youtube.com/'}, {'k': 'dzen', 'n': 'Дзен', 'u': 'https://dzen.ru/'}]}, ensure_ascii=False) + ';</script>\n'
i = html.index('<script')
import base64, os
epimg = {n: 'data:image/jpeg;base64,' + base64.b64encode(open(ROOT + '/brand/img/ep/%s.jpg' % n, 'rb').read()).decode() for n in ['1', '2', '3', '4', '5', '6', 'cad']}
shim = '<script>window.__EP_IMG=' + json.dumps(epimg) + ';</script>\n' + shim
html = html[:i] + social + shim + html[i:]
pages = json.loads(subprocess.check_output(['node', SP + '/render-pages.js', SP + '/pv-data']))
inner = r"""<script>(function(){document.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||h[0]!=='/')return;e.preventDefault();parent.__nav(h);},true);})();</script>"""

nav = r"""<script>window.__PREVIEW=true;window.__PAGES=%s;
(function(){
  function norm(h){var p=h.split('#')[0].split('?')[0];if(p&&p!=='/'&&p.slice(-1)!=='/')p+='/';return p;}
  function close(){var o=document.getElementById('pvPage');if(o)o.remove();}
  window.__nav=function(h){var p=norm(h),hash=h.indexOf('#')>=0?h.slice(h.indexOf('#')):'';
    if(window.__PAGES[p]){var o=document.getElementById('pvPage');if(!o){o=document.createElement('div');o.id='pvPage';o.innerHTML='<div class="pvbar"><b>Страница сайта</b><span></span><button type="button">← В конструктор</button></div><div class="pvsc"><div class="pvh"></div></div>';document.body.appendChild(o);o.querySelector('button').onclick=close;
        var hh=o.querySelector('.pvh');hh.attachShadow({mode:'open'});hh.shadowRoot.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;var h2=a.getAttribute('href');if(h2&&h2[0]==='/'){e.preventDefault();window.__nav(h2);}});}
      o.querySelector('span').textContent=p;var d=new DOMParser().parseFromString(window.__PAGES[p],'text/html'),css='';
      d.querySelectorAll('style').forEach(function(x){css+=x.textContent;});d.querySelectorAll('link[rel=stylesheet]').forEach(function(l){if(!document.querySelector('link[href="'+l.href+'"]')){var n=document.createElement('link');n.rel='stylesheet';n.href=l.href;document.head.appendChild(n);}});
      css=css.replace(/:root/g,':host').replace(/(^|[}\s,])body(?=[\s{,])/g,'$1.pv-body').replace(/@media\s*\((max|min)-width/g,'@container pv ($1-width');d.querySelectorAll('script').forEach(function(x){x.remove();});
      o.querySelector('.pvh').shadowRoot.innerHTML='<style>'+css+':host{display:block}.pv-body{container:pv / inline-size;margin:0}</style><div class="pv-body">'+d.body.innerHTML+'</div>';o.querySelector('.pvsc').scrollTop=0;return true;}
    if(p==='/'||p===''){close();if(hash)location.hash=hash;return true;}
    if(p==='/crm.html/'){alert('CRM — отдельная ссылка на просмотр');return true;}
    return false;};
  document.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||h[0]!=='/')return;if(window.__nav(h))e.preventDefault();},true);
})();</script>
<style>#pvPage{position:fixed;inset:0;z-index:9999;background:#fff;display:grid;grid-template-rows:auto 1fr}#pvPage .pvbar{display:flex;gap:12px;align-items:center;padding:8px 14px;background:#19317B;color:#fff;font:600 13px Inter,sans-serif}#pvPage .pvbar span{flex:1;opacity:.7}#pvPage .pvbar button{border:0;border-radius:6px;padding:6px 14px;background:#fff;color:#19317B;font:600 13px Inter,sans-serif;cursor:pointer}#pvPage .pvsc{overflow:auto;background:#F5F6F8}</style>""" % json.dumps(pages, ensure_ascii=False).replace('</', '<\\/')
bar = r'''<div class="sdemo"><b>Демо сайта</b><span>Данные вымышленные, правки живут до перезагрузки.</span><span style="flex:1"></span><span>Войти как:</span><button type="button" data-l="client">Заказчик</button><button type="button" data-l="arch">Архитектор</button><button type="button" data-l="company">Строительная компания</button><button type="button" data-l="out">Выйти</button></div>
<style>.sdemo{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 16px;background:#19317B;color:#fff;font:400 13px Inter,sans-serif}.sdemo b{font-weight:600}.sdemo>span:nth-of-type(1){color:#D9DEE8}.sdemo button{border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font:500 13px Inter,sans-serif}.sdemo button[aria-pressed="true"]{background:#fff;color:#19317B}@media (max-width:760px){.sdemo>span:nth-of-type(1){display:none}}</style>
<script>(function(){var b=document.querySelector('.sdemo'),app=document.getElementById('app');if(app)app.parentNode.insertBefore(b,app);var cur=(localStorage.getItem('dk-token')||'').replace('demo-','');b.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',String(x.dataset.l===cur));x.onclick=function(){if(x.dataset.l==='out'){localStorage.removeItem('dk-token');location.reload();return;}window.__DEMO_LOGIN(x.dataset.l);};});
if(window.__DEMO_CODE){var hc=document.createElement('span');hc.innerHTML='Коды для проверки: визуализации <b>'+window.__DEMO_CODE+'</b>'+(window.__DEMO_CODE_EP?' · ЭП <b>'+window.__DEMO_CODE_EP+'</b> · ArchiCAD <b>'+window.__DEMO_CODE_CAD+'</b>':'');b.insertBefore(hc,b.children[2]);}var op=localStorage.getItem('ld-demo-open');if(op){localStorage.removeItem('ld-demo-open');setTimeout(function(){window.DK&&DK.Market&&DK.Market.openCabinet(op==='company'?'company':'client');},900);}})();</script>'''
html = html.replace('</body>', nav + bar + '</body>', 1)
for pat in [r'<!doctype html>\s*', r'<html[^>]*>\s*', r'</html>\s*', r'<head>\s*', r'</head>\s*', r'<body>\s*', r'</body>\s*', r'<meta charset[^>]*>\s*', r'<meta name="viewport"[^>]*>\s*', r'<link rel="icon"[^>]*>\s*']:
    html = re.sub(pat, '', html, count=0, flags=re.I)
open(SP + '/konstruktor-doma.html', 'w', encoding='utf-8').write(html)
print(len(html), len(pages))
