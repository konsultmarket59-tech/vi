# Демо-карточки каталога (dom-konstruktor/demo + demo-content.js) — в данные HTML-просмотров
import json, base64, re, datetime
ROOT = '/home/user/vi/dom-konstruktor'
def add_demo(data):
    src = open(ROOT + '/demo-content.js', encoding='utf-8').read()
    def arr(name):
        body = src[src.index('const %s = [' % name):]
        body = body[:body.index('\n];') + 3]
        return body
    import subprocess
    js = 'const fs=require("fs");' + arr('ARCH') + arr('BUILDERS') + 'process.stdout.write(JSON.stringify({ARCH,BUILDERS}))'
    d = json.loads(subprocess.check_output(['node', '-e', js]))
    day = lambda n: (datetime.datetime(2026, 10, 28) - datetime.timedelta(days=n)).isoformat() + '.000Z'
    comps = [c for c in data.get('companies.json', []) if not c.get('demo')]
    users = [u for u in data.get('users.json', []) if not u.get('demo')]
    for i, c in enumerate(d['BUILDERS']):
        x = dict(type='builder', status='approved', demo=True, at=day(40 - i * 5), cities=c['regions'], phone='', email='', site='', rating=None, reviews=0); x.update(c); comps.append(x)
    for i, a in enumerate(d['ARCH']):
        x = dict(status='approved', demo=True, at=day(35 - i * 6), regions=[a['city']], materials=[], classes=[], phone='', email='', site='', rating=None, reviews=0); x.update(a); comps.append(x)
        users.append(dict(id=a['id'], demo=True, role='architect', archStatus='verified', name=a['name'], email=a['id'] + '@demo.invalid', phone='', city=a['city'], about=a['about'], salt='x', pass_='x', at=day(35 - i * 6)))
    for u in users:
        if 'pass_' in u: u['pass'] = u.pop('pass_')
    data['companies.json'] = comps; data['users.json'] = users
    for i, x in enumerate(json.load(open(ROOT + '/demo/projects.json'))):
        for f in x['files']:
            data['projects/%s/%s' % (x['id'], f)] = 'b64:' + base64.b64encode(open('%s/demo/img/%s/%s' % (ROOT, x['id'], f), 'rb').read()).decode()
        data['projects/%s/project.json' % x['id']] = dict(id=x['id'], demo=True, owner='demo-' + x['author'], title=x['title'], about=x['about'], price=x['price'], license=x['license'], area=x['area'], floors=x['floors'], size=x['size'],
            project=x['project'], files=x['files'], status='published', votes={}, requests=[], at=day(30 - i * 3), updatedAt=day(30 - i * 3), quality=dict(score=x['quality']['score'], errs=x['quality']['errs'], warns=x['quality']['warns']))
    return data
