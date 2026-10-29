import json, re, datetime, sys
SP = sys.argv[1]; ROOT = '/home/user/vi/dom-konstruktor'
data = json.load(open(SP + '/demo-data.json'))
order = {'Иван Петров': (0, 9, 40), 'Марина Волкова': (1, 13, 15), 'Ольга Смирнова': (2, 11, 5), 'Алексей Кузнецов': (4, 16, 30)}
for k, v in data.items():
    if k.endswith('lead.json'):
        d, hh, mm = order[v['answers']['name']]
        t = datetime.datetime(2026, 10, 24 - d, hh - 5, mm)
        v['at'] = t.isoformat() + '.000Z'
    if k == 'users.json':
        for u in v:
            if u.get('staffRole') == 'admin': u['name'] = 'Демо Администратор'
# верификация в демо: один проект проверен и исправлен, второй ждёт оплаты
for k, v in data.items():
    if k.endswith('project.json') and v['title'].startswith('Дом 192'):
        v['verify'] = {'status': 'verified', 'price': 15000, 'fixed': True, 'requestedAt': '2026-10-20T09:10:00.000Z', 'at': '2026-10-23T12:40:00.000Z', 'by': 'Демо Администратор', 'note': 'Проверили планировку и конструктив, расширили коридор до 1,2 м.',
                       'log': [{'at': '2026-10-20T09:10:00.000Z', 'text': 'заявка на верификацию от автора'}, {'at': '2026-10-20T14:00:00.000Z', 'by': 'Демо Администратор', 'text': 'оплачено'}, {'at': '2026-10-21T10:00:00.000Z', 'by': 'Демо Администратор', 'text': 'в работе'}, {'at': '2026-10-22T16:20:00.000Z', 'by': 'Демо Администратор', 'text': 'исправления сохранены в проект'}, {'at': '2026-10-23T12:40:00.000Z', 'by': 'Демо Администратор', 'text': 'проверено: Проверили планировку и конструктив, расширили коридор до 1,2 м.'}]}
    if k.endswith('project.json') and v['title'].startswith('Мансардный'):
        v['verify'] = {'status': 'requested', 'price': 15000, 'requestedAt': '2026-10-24T08:30:00.000Z', 'log': [{'at': '2026-10-24T08:30:00.000Z', 'text': 'заявка на верификацию от автора'}]}
html = open(ROOT + '/crm.html', encoding='utf-8').read()
api = open(ROOT + '/crm-api.js', encoding='utf-8').read()
def js(p): return open(p, encoding='utf-8').read().replace('</script', '<\\/script')
head = ('<script>window.__DEMO_DATA=' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + ';</script>\n'
        '<script>window.__CRM_API=function(require,module,process,Buffer){\n' + api.replace('</script', '<\\/script') + '\n};</script>\n'
        + '<script>window.__CREDITS=function(require,module,process,Buffer){\n' + open(ROOT + '/credits.js', encoding='utf-8').read().replace('</script', '<\\/script') + '\n};</script>\n'
        + ''.join('<script>window.__MOD_%s=function(require,module,process,Buffer,__dirname){\n%s\n};</script>\n' % (n, open(ROOT + '/' + f, encoding='utf-8').read().replace('</script', '<\\/script')) for n, f in [('content', 'content.js'), ('docs', 'docs-content.js'), ('cms', 'cms-store.js'), ('pages', 'pages.js')])
        + '<script>window.__PAGES_CSS=' + json.dumps(open(ROOT + '/css/pages.css', encoding='utf-8').read()).replace('</', '<\\/') + ';</script>\n'
        '<script>' + js(SP + '/demo-shim.js') + '</script>\n')
first = True
def rep(m):
    global first
    s = '<script>\n' + js(ROOT + '/' + m.group(1)) + '\n</script>'
    if first: s = head + s; first = False
    if m.group(1) == 'js/crm.js': s += '\n<script>' + js(SP + '/demo-bar.js') + '</script>'
    return s
html = re.sub(r'<script src="([^"]+)"></script>', rep, html)
css = ('.demobar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:7px 20px;background:#19317B;color:#fff;font:400 13px Inter,sans-serif}'
       '.demobar b{font-weight:600}.demobar>span:nth-of-type(1){color:#D9DEE8}'
       '.demobar button{border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font:500 13px Inter,sans-serif}'
       '.demobar button[aria-pressed="true"]{background:#fff;color:#19317B;border-color:#fff}'
       '@media (max-width:760px){.demobar{padding:6px 12px}.demobar>span:nth-of-type(1){flex-basis:100%;order:9;font-size:12px}}\n')
html = html.replace('</style>', css + '</style>', 1)
import base64
ld = re.sub(r'@font-face\s*\{[^}]*\}', '', open(ROOT + '/brand/ld.css', encoding='utf-8').read())
html = html.replace('<link rel="stylesheet" href="brand/ld.css">', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap">\n<style>' + ld + '</style>')
LOGO = 'data:image/svg+xml;base64,' + base64.b64encode(open(ROOT + '/brand/logo-horizontal.svg', 'rb').read()).decode()
html = html.replace('/brand/logo-horizontal.svg', LOGO).replace('brand/logo-horizontal.svg', LOGO)
html = re.sub(r'<title>[^<]*</title>', '<title>CRM Логика Дома</title>', html)
for pat in [r'<!doctype html>\s*', r'<html[^>]*>\s*', r'</html>\s*', r'<head>\s*', r'</head>\s*', r'<body>\s*', r'</body>\s*', r'<meta charset[^>]*>\s*', r'<meta name="viewport"[^>]*>\s*', r'<link rel="icon"[^>]*>\s*']:
    html = re.sub(pat, '', html, flags=re.I)
open(SP + '/crm-demo.html', 'w', encoding='utf-8').write(html)
print(len(html))
