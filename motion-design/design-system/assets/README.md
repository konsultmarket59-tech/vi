# Assets — placeholders

Физические файлы бренда (логотипы, spark-марки, паттерны, фото). Пока
только структура — файлы подгружу, когда пришлёшь.

```
assets/
├── logos/
│   ├── avatar-circle.png       ← круглая аватарка-бейдж (нужна для маски лица!)
│   ├── wordmark-color.svg      ← горизонтальный цветной леттеринг
│   └── wordmark-inverted.svg   ← горизонтальный белый на чёрном
├── graphics/
│   ├── spark-pink.png          ← подпись бренда — starburst
│   ├── spark-cyan.png
│   ├── halftone-tile.png       ← паттерн для фонов (опц.)
│   └── hero-banner.png         ← пример hero-кадра (опц.)
├── backgrounds/
│   └── gradient-duotone.png    ← pink→purple→cyan (опц., генерируется скриптом)
└── people/
    └── founder-victoria/       ← фото Виктории Ладыгиной (если попадает в кадр)
```

Приоритет для моушн-пайплайна:
1. `logos/avatar-circle.png` — стиль круга-аватарки, куда уплывает лицо.
2. `graphics/spark-*.png` — украшают ключевые цифры/акценты в инфографике.
3. Всё остальное — опционально, пайплайн работает и без них.
