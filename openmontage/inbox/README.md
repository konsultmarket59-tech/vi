# inbox

Положите сюда исходное видео (например `head-footage.mp4`), закоммитьте и
запушьте в ветку `claude/openmontage-repository-1hcdsk`. Эта папка (в отличие
от `projects/`) не в `.gitignore`, так что файл реально попадёт в репозиторий.

Как загрузить:

- **Через git** (без ограничений по размеру): `git add openmontage/inbox/head-footage.mp4 && git commit -m "..." && git push`
- **Через веб-интерфейс GitHub** (`Add file → Upload files`): у браузерной загрузки
  лимит ~25 МБ на файл — если ваше видео больше, используйте git или сожмите файл.

После этого напишите мне — я заберу файл из `inbox/`, положу в
`projects/<name>/raw/` и запущу пайплайн `talking-head`.
