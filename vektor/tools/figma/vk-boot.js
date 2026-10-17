// Запускается до редактора: русский интерфейс по умолчанию и без приветственного тура.
(function () {
  try {
    if (!localStorage.getItem('open-pencil-locale')) localStorage.setItem('open-pencil-locale', 'ru');
  } catch (e) { }
})();
