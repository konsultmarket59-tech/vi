/* Модель дома на сервере: те же js/model.js и проверки, что в браузере (vm без DOM).
   Нужна, чтобы фильтр качества при сохранении проекта нельзя было обойти запросом в обход интерфейса. */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');

module.exports = function modelVm(ROOT) {
  const sb = { console }; sb.window = sb; sb.DK = {}; vm.createContext(sb);
  for (const f of ['config.js', 'model.js', 'furniture.js', 'facade.js', 'estimate.js', 'site.js']) {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sb, { filename: f }); } catch (e) { console.error('model-vm', f, e.message); }
  }
  const DK = sb.DK;
  const prep = (p) => { const q = DK.normalize(DK.migrate(JSON.parse(JSON.stringify(p)))); ['b', 'f1', 'f2', 'f3'].forEach(k => { if (!q.levels[k]) q.levels[k] = DK.emptyLevel(); }); return q; };
  return {
    DK, prep,
    quality(p) { try { return DK.quality(prep(p)); } catch (e) { return { ok: false, errs: [{ txt: 'Не удалось прочитать проект' }], warns: [], score: 0 }; } },
  };
};
