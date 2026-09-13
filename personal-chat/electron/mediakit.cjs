// Медиа: киношные движения камеры, ракурсы, свет и трендовые стили.
//
// Зачем отдельный модуль.
//
// Генерация картинки или ролика упирается не в модель, а в промпт. Разница
// между «облёт камеры вокруг дома» и «медленная орбита вокруг героя, камера
// едва заметно опускается, герой в центре кадра» — это разница между роликом,
// который можно показать, и тем, который переснимают. Слова, которые эту
// разницу делают, кончаются быстро, и каждый раз вспоминать их заново —
// работа, которую должно делать приложение.
//
// Поэтому здесь лежит не «набор красивых слов», а рабочий словарь: что
// происходит с камерой, зачем этот приём нужен и какой строкой он пишется в
// промпт. Русское описание — чтобы выбрать; английская строка — чтобы модель
// поняла: почти все модели изображений и видео обучены на английских
// описаниях, и русский промпт они понимают заметно хуже.
//
// Отдельное правило, без которого половина списка бесполезна: в промпте важно
// не только НАЗВАНИЕ движения, но и СКОРОСТЬ с характером — плавно, рывком,
// едва заметно. Одна и та же траектория с разной скоростью передаёт разные
// чувства, поэтому темп вынесен отдельным полем, а не спрятан внутрь описаний.

/** Темп движения. Без него описание траектории наполовину пустое. */
const PACES = [
  { id: "smooth", name: "Плавно", prompt: "slow, smooth, steady motion" },
  { id: "slow", name: "Едва заметно", prompt: "very slow, almost imperceptible motion" },
  { id: "brisk", name: "Живо", prompt: "brisk, confident motion" },
  { id: "snap", name: "Рывком", prompt: "sudden, snappy motion" },
];

/**
 * Двадцать движений камеры.
 *
 * `what` — что физически происходит, `why` — ради какого чувства это делают.
 * Второе важнее первого: выбирают приём под задачу сцены, а не под красоту
 * названия, и человек, который не снимал, по одному названию не выберет.
 */
const CAMERA_MOVES = [
  {
    id: "static", name: "Статика", en: "Static Shot",
    what: "Камера неподвижна, всё движение — внутри кадра: люди, свет, ветер.",
    why: "Тишина и покой. Даёт разглядеть детали и делает любое следующее движение камеры в разы заметнее.",
    prompt: "static locked-off camera, no camera movement, all motion happens within the frame",
  },
  {
    id: "pan", name: "Панорама", en: "Pan",
    what: "Камера на месте, поворачивается влево или вправо — как поворот головы.",
    why: "Перевести внимание с одного героя на другого или постепенно раскрыть локацию.",
    prompt: "camera pans horizontally from left to right, pivoting on a fixed point",
  },
  {
    id: "whip-pan", name: "Резкая панорама", en: "Whip Pan",
    what: "Молниеносный поворот со смазыванием картинки.",
    why: "Бесшовный переход между сценами: смаз прячет склейку.",
    prompt: "fast whip pan with motion blur, used as a transition",
  },
  {
    id: "tilt-up", name: "Наклон вверх", en: "Tilt Up",
    what: "Камера на месте, наклоняется по вертикали вверх.",
    why: "Визуально увеличивает объект: власть героя над зрителем, значительность.",
    prompt: "camera tilts upward from a fixed position, revealing the subject from below to above",
  },
  {
    id: "tilt-down", name: "Наклон вниз", en: "Tilt Down",
    what: "Камера на месте, наклоняется по вертикали вниз.",
    why: "Спускает внимание от общего плана к конкретной детали.",
    prompt: "camera tilts downward from a fixed position, moving attention from the wide view to a detail",
  },
  {
    id: "zoom-in", name: "Медленный наезд зумом", en: "Slow Zoom In",
    what: "Камера не едет — объектив медленно сужает кадр.",
    why: "Нарастание напряжения, сцена осознания. «Объектив эмпатии».",
    prompt: "slow zoom in, lens tightening on the subject, camera body stays put",
  },
  {
    id: "zoom-out", name: "Медленный отъезд зумом", en: "Slow Zoom Out",
    what: "Камера неподвижна, объектив постепенно расширяет кадр.",
    why: "Герой уменьшается, мир растёт: одиночество, прощание, финал сцены.",
    prompt: "slow zoom out, lens widening, subject becoming small within a growing world",
  },
  {
    id: "crash-zoom", name: "Крэш-зум", en: "Crash Zoom",
    what: "Мгновенный резкий рывок объектива без плавности.",
    why: "Кинематографический восклицательный знак: неловкость в комедии, удар в экшене.",
    prompt: "crash zoom, instant aggressive zoom punch-in",
  },
  {
    id: "dolly-in", name: "Долли — наезд", en: "Dolly In",
    what: "Камера физически въезжает вперёд к герою.",
    why: "Вовлечение и близость за счёт смещения планов. Главный приём напряжённого диалога.",
    prompt: "dolly in, camera physically moves toward the subject, foreground and background shift in parallax",
  },
  {
    id: "dolly-zoom", name: "Эффект Вертиго", en: "Dolly Zoom",
    what: "Камера едет вперёд, объектив одновременно отъезжает назад.",
    why: "Лицо в центре не меняется, фон растягивается: тревога, диссоциация, подсознательный испуг.",
    prompt: "dolly zoom vertigo effect, camera pushes in while lens zooms out, background stretches and warps",
  },
  {
    id: "truck", name: "Трак — боковой проезд", en: "Tracking Shot",
    what: "Камера едет вбок параллельно сцене.",
    why: "Пространство раскрывается слой за слоем, передний план задаёт ритм. Витрины, лица в толпе, идущий герой.",
    prompt: "lateral tracking shot, camera trucks sideways parallel to the scene, foreground elements sweep past",
  },
  {
    id: "push-past", name: "Проезд сквозь передний план", en: "Push-Past",
    what: "Камера идёт вперёд и проходит сквозь препятствие: занавес, ворота, ветки, толпу.",
    why: "Момент слепоты сменяется физическим проникновением зрителя внутрь новой сцены.",
    prompt: "camera pushes past a foreground obstruction — curtain, branches, doorway — and emerges into the scene",
  },
  {
    id: "orbit", name: "Орбита", en: "Orbit Shot",
    what: "Камера описывает дугу или круг вокруг героя, он остаётся в центре.",
    why: "Медленная дуга — раздумье; быстрый полный круг — кульминация и остановка времени.",
    prompt: "orbit shot, camera arcs around the subject who stays centered in frame",
  },
  {
    id: "follow", name: "Следование", en: "Follow Shot",
    what: "Камера идёт строго за спиной героя, лица не видно.",
    why: "Двойное напряжение: не видно ни того, что впереди, ни того, что чувствует герой. Классика хоррора.",
    prompt: "follow shot from directly behind the subject, over-the-shoulder, face not visible",
  },
  {
    id: "back-track", name: "Отступление", en: "Back Tracking",
    what: "Камера отступает назад перед героем, который идёт прямо на неё.",
    why: "Герой или группа выглядят решительными и сильными. Визитная карточка спортивного и военного кино.",
    prompt: "camera tracks backward in front of the subject walking straight toward the lens",
  },
  {
    id: "side-track", name: "Боковой трекинг", en: "Side Tracking",
    what: "Камера едет рядом с героем на его скорости.",
    why: "Фон размывается, скорость и физика движения читаются максимально.",
    prompt: "side tracking shot matching the subject's speed, background motion-blurred",
  },
  {
    id: "low-track", name: "Низкий трекинг", en: "Low Tracking",
    what: "Камера у самой земли: шаги, колёса, асфальт.",
    why: "Машина превращается в монстра, а взрослые ноги — в лес глазами ребёнка.",
    prompt: "low tracking shot at ground level, camera inches above the floor",
  },
  {
    id: "handheld", name: "Ручная камера", en: "Handheld",
    what: "Съёмка с рук: дыхание, микродрожь, покачивание при ходьбе.",
    why: "Убирает глянец: хаос, погоня, документальная достоверность, присутствие.",
    prompt: "handheld camera with natural breathing micro-shake and walking sway, documentary feel",
  },
  {
    id: "snorricam", name: "Снорикам", en: "SnorriCam",
    what: "Камера закреплена на торсе героя и смотрит ему в лицо.",
    why: "Лицо неподвижно в центре, фон бешено вращается: паника, головокружение, потеря контроля.",
    prompt: "snorricam shot, camera rigged to the subject's body facing them, subject locked in frame while the world spins behind",
  },
  {
    id: "crane-up", name: "Подъём крана", en: "Crane Up",
    what: "Камера плавно поднимается вертикально над сценой — «взгляд бога».",
    why: "Герой становится частью большого мира: торжественность, финал, одиночество, завершённость.",
    prompt: "crane up, camera rises vertically above the scene into a god's-eye view",
  },
  {
    id: "drone", name: "Дрон", en: "Drone Shot",
    what: "Камера свободно летит на любой высоте в произвольном направлении.",
    why: "Открывающие кадры, эпические пейзажи, переходы между локациями.",
    prompt: "aerial drone shot, camera flies freely over the landscape",
  },
  {
    id: "pov", name: "От первого лица", en: "Point of View",
    what: "Мир прямо из глаз героя: видны руки, камера дышит и покачивается при шагах.",
    why: "Зритель перестаёт быть наблюдателем и становится участником.",
    prompt: "first-person POV shot, subject's own hands visible, camera breathes and sways with each step",
  },
];

/**
 * Девять ракурсов для концептуального портрета.
 *
 * Один и тот же герой при разном угле, крупности и искажении перспективы даёт
 * совершенно разное ощущение — ракурс здесь не украшение, а смысл кадра.
 */
const SHOT_ANGLES = [
  {
    id: "dynamic-profile", name: "Динамичный профиль с движением",
    why: "Быстрый разворот головы, размытие волос. Оживляет статичный портрет.",
    prompt: "dynamic profile with motion, quick head turn, hair caught in motion blur",
  },
  {
    id: "standing-profile", name: "Профиль стоя",
    why: "Боковой угол подчёркивает линию силуэта и изгиб фигуры. Скульптурная композиция.",
    prompt: "full-height side profile, clean sculptural composition emphasising the silhouette",
  },
  {
    id: "extreme-low", name: "Экстремально нижний угол",
    why: "Обувь и ноги на первом плане, корпус уходит вверх. Максимум мощи и масштаба.",
    prompt: "extreme low angle from the ground, shoes and legs dominant in the foreground, body towering upward",
  },
  {
    id: "top-down", name: "Вид сверху",
    why: "Камера над героем, поза раскрыта целиком. Добавляет уязвимости.",
    prompt: "top-down overhead view looking straight down, full pose revealed",
  },
  {
    id: "wide-close", name: "Крупный план с искажённой оптикой",
    why: "Сверхблизкое расстояние, широкоугольное искажение. Экспериментальные, провокационные кадры.",
    prompt: "extreme close-up with wide-angle lens distortion, face very close to the lens",
  },
  {
    id: "high-intimate", name: "Верхний камерный ракурс",
    why: "Фигура собрана, голова опущена, съёмка чуть сверху. Интимное, сосредоточенное настроение.",
    prompt: "slightly high intimate angle, body drawn in, head lowered, quiet concentrated mood",
  },
  {
    id: "low-full", name: "Нижний ракурс в полный рост",
    why: "Камера снизу, скрещённые руки, взгляд вниз. Доминанта, вытянутый силуэт.",
    prompt: "low angle full-length shot, arms crossed, gaze cast downward, elongated dominant silhouette",
  },
  {
    id: "neck-detail", name: "Деталь шеи и костюма",
    why: "Фокус на текстуре и анатомии. Для кадров, где важна не эмоция, а плотность образа.",
    prompt: "detail shot of neck and garment, focus on fabric texture and anatomy rather than expression",
  },
  {
    id: "three-quarter-back", name: "Три четверти со спины",
    why: "Лицо через плечо, фокус на деталях костюма. Интрига и загадка.",
    prompt: "three-quarter view from behind, face turned over the shoulder, costume details in focus",
  },
];

/** Девять схем освещения. Меняют кадр парой слов сильнее, чем что угодно другое. */
const LIGHTING = [
  { id: "overcast", name: "Пасмурный свет", en: "Overcast", why: "Ровный матовый свет без теней: меланхолия, честный портрет.", prompt: "overcast soft flat daylight, no harsh shadows" },
  { id: "golden-backlight", name: "Золотой контровой", en: "Golden Backlight", why: "Солнце из-за спины, тёплый ореол по контуру. Романтика и премиум.", prompt: "golden hour backlight, warm rim halo around the subject, sun behind" },
  { id: "window", name: "Оконный свет", en: "Window Light", why: "Мягкий рассеянный день: естественность, скандинавский минимализм.", prompt: "soft diffused window light from the side, natural scandinavian minimalism" },
  { id: "moonlight", name: "Лунный свет", en: "Moonlight", why: "Серебристый холод, ночь, тихая мистика.", prompt: "cool silver moonlight, night, quiet mysterious mood" },
  { id: "gobo", name: "Свет сквозь жалюзи", en: "Gobo / Blinds", why: "Полосы тени на лице: нуар-детектив, графичность.", prompt: "gobo lighting through venetian blinds, hard stripes of shadow across the face, film noir" },
  { id: "low-key", name: "Лоу-кей", en: "Low-Key", why: "Тёмный фон, объём из тени, премиум. Парфюм, часы, напитки.", prompt: "low-key lighting, dark background, form carved out of shadow, premium product mood" },
  { id: "spotlight", name: "Сценический софит", en: "Spotlight", why: "Луч из темноты: театр, всё внимание на герое.", prompt: "single theatrical spotlight out of darkness, everything else falls away" },
  { id: "candlelight", name: "Свет свечи", en: "Candlelight", why: "Мягкое дрожащее тепло: интимность, старинная живопись.", prompt: "warm flickering candlelight, intimate old-master painting quality" },
  { id: "color-gel", name: "Цветные гели", en: "Color Gel", why: "Модный клип, дерзость.", prompt: "bold coloured gel lighting, magenta and cyan cross-light, music-video energy" },
];

/**
 * Трендовые стили.
 *
 * Строки промптов взяты как есть: они проверены на настоящих генерациях, и
 * переписывать их «покрасивее» значило бы потерять именно то, ради чего их
 * записывали. `[объект]` подставляется из того, что человек описал сам.
 */
const STYLES = [
  {
    id: "mixed-media", name: "Mixed Media — коллаж",
    why: "Фотография плюс рисованные элементы, текстуры и коллажные вставки. Многослойная история, которая выглядит ручной работой. Универсальный способ разбавить обычные фотографии или сделать запоминающийся постер.",
    needsPhoto: true,
    prompt:
      "extreme close-up macro shot of a handcrafted collage artwork: the main subject is cut out of a photograph " +
      "and layered with torn paper, hand-drawn ink lines, washi tape, fabric scraps and printed texture, " +
      "visible paper fibres and glue edges, tactile handmade feel",
  },
  {
    id: "rhinestones", name: "Стразы",
    why: "Сердечки, разноцветные камни — от фэшн-кампаний до арт-объектов. Достаточно указать объект, модель сама расставит акценты.",
    needsPhoto: true,
    prompt:
      "[объект] completely covered in colorful rhinestones, gems and bedazzled crystals — hearts, stars, flowers " +
      "in pink, blue, green, purple, gold and silver. Hyper-detailed, studio lighting, photorealistic, " +
      "maximalist sparkle aesthetic",
  },
  {
    id: "crayon-doodle", name: "Каракули восковыми мелками",
    why: "Причудливые персонажи, как будто их нарисовал ребёнок восковыми мелками: небрежная штриховка и абсурдно преувеличенные черты. Чем кривее — тем смешнее.",
    needsPhoto: true,
    prompt:
      "doodle-style character that looks intentionally ugly and funny, like a child's crayon drawing. " +
      "Rough black crayon or pencil outline, messy scribble coloring, absurdly exaggerated facial features",
  },
  {
    id: "risograph", name: "Ризограф",
    why: "Печать в два-три цвета со смещением слоёв и зерном. Плакатная графика, которая читается издалека.",
    prompt:
      "risograph print look, two or three spot colours with visible misregistration, coarse paper grain, " +
      "flat poster graphics, limited palette",
  },
  {
    id: "claymation", name: "Пластилин",
    why: "Мягкие объёмы, отпечатки пальцев на массе, кукольный свет. Тёплое и рукотворное — противоядие глянцу.",
    prompt:
      "claymation stop-motion look, soft modelling-clay volumes with visible fingerprints and tool marks, " +
      "miniature set, shallow depth of field, warm practical lighting",
  },
  {
    id: "cyanotype", name: "Цианотипия",
    why: "Синий отпечаток с белым контуром и разводами. Архивная, почти ботаническая фактура.",
    prompt:
      "cyanotype print, deep prussian blue with white silhouettes, uneven brushed emulsion edges, " +
      "aged paper texture, botanical archive feel",
  },
];

/**
 * Короткие команды формата.
 *
 * Это не команды какой-то модели и не магия — это короткие обозначения ФОРМАТА
 * визуала. `/anatomy` короче, чем «покажи объект в разобранном виде, с
 * подписанными частями», а модель понимает и то и другое. Смысл в скорости:
 * формат выбирается одним щелчком, а голова остаётся для темы.
 *
 * У каждой команды есть английская строка — её и получает модель. Русское
 * пояснение здесь, чтобы выбрать, а не чтобы переводить.
 */
const FORMAT_COMMANDS = [
  { group: "Разбор и структура", hint: "Показать, из чего состоит объект, идея или процесс", items: [
    ["anatomy", "анатомия объекта или идеи", "an anatomical breakdown of the subject with labelled parts"],
    ["layers", "структура по слоям", "the subject separated into stacked labelled layers"],
    ["xray", "внутреннее устройство", "an x-ray view revealing the internal structure"],
    ["explodedview", "компоненты в разнесённом виде", "an exploded view with components separated in space"],
    ["cutaway", "объект в разрезе", "a cutaway view with part of the shell removed"],
    ["crosssection", "поперечное сечение", "a clean cross-section through the subject"],
    ["insideout", "взгляд изнутри наружу", "a view from inside the subject looking outward"],
    ["breakdown", "понятный визуальный разбор", "a clear visual breakdown of the subject into parts"],
    ["deconstruct", "деконструкция на элементы", "the subject deconstructed into its individual elements"],
    ["mechanism", "как работает механизм", "a diagram of the mechanism showing how it works"],
  ] },
  { group: "Схемы и инфографика", hint: "Объяснить процессы, системы и методики", items: [
    ["infographic", "полноценная инфографика", "a full infographic with headings, figures and icons"],
    ["diagram", "наглядная схема", "a clean explanatory diagram"],
    ["flowchart", "блок-схема процесса", "a flowchart of the process with decision points"],
    ["mindmap", "карта мыслей", "a mind map with a central idea and branches"],
    ["roadmap", "дорожная карта", "a roadmap with milestones along a path"],
    ["timeline", "события на временной шкале", "a timeline with events placed along it"],
    ["process", "процесс по шагам", "a step-by-step process laid out in order"],
    ["workflow", "рабочий сценарий", "a workflow showing who does what and when"],
    ["framework", "визуальная методика", "a named framework drawn as a visual model"],
    ["systemmap", "карта связей внутри системы", "a system map showing connections between parts"],
  ] },
  { group: "Сравнения", hint: "Контраст — особенно хорошо работает в каруселях", items: [
    ["beforeafter", "наглядное до и после", "a before and after comparison, clearly split"],
    ["thenvsnow", "как было и как стало", "a then versus now comparison"],
    ["versus", "противостояние двух вариантов", "a versus layout pitting two options against each other"],
    ["comparison", "сравнение по критериям", "a comparison table across several criteria"],
    ["sidebyside", "два варианта рядом", "two variants placed side by side"],
    ["thisorthat", "выбор между двумя подходами", "a this-or-that choice between two approaches"],
    ["goodbad", "хороший и плохой пример", "a good example next to a bad one"],
    ["wrongright", "неправильно и правильно", "a wrong way and a right way, marked"],
    ["oldnew", "старый и новый подход", "the old approach beside the new one"],
    ["manualvsai", "ручная работа против ИИ", "manual work compared with an AI-assisted result"],
  ] },
  { group: "Посты и карусели", hint: "Готовые структуры для экспертного контента", items: [
    ["carousel", "структура поста-карусели", "a carousel post structure, one idea per card"],
    ["checklist", "чек-лист с пунктами", "a checklist with ticked items"],
    ["cheatsheet", "компактная шпаргалка", "a compact cheat sheet, dense but readable"],
    ["howto", "инструкция «как сделать»", "a how-to guide with numbered instructions"],
    ["stepbystep", "пошаговый разбор", "a step-by-step walkthrough"],
    ["tips", "подборка полезных советов", "a set of practical tips"],
    ["mistakes", "список частых ошибок", "a list of common mistakes"],
    ["mythsfacts", "мифы и факты", "myths paired with the facts that correct them"],
    ["dosdonts", "что делать и чего избегать", "dos and don'ts in two columns"],
    ["faq", "ответы на частые вопросы", "a FAQ layout with questions and answers"],
  ] },
  { group: "Реклама и наружка", hint: "Показать идею кампании в реальном окружении", items: [
    ["billboard", "реклама на городском билборде", "the creative mounted on a city billboard, photographed in context"],
    ["3dbillboard", "объёмная 3D-реклама", "an anamorphic 3D billboard with the subject breaking out of the frame"],
    ["adcreative", "рекламный креатив", "a polished advertising creative for the brand"],
    ["citylight", "макет в уличном ситилайте", "the poster inside a backlit street citylight unit"],
    ["busstopad", "реклама на остановке", "the ad in a bus stop shelter panel"],
    ["airportad", "реклама в аэропорту", "a large format ad in an airport terminal"],
    ["subwayad", "реклама в метро", "the poster on a subway station wall"],
    ["buswrap", "брендирование автобуса", "a full bus wrap in the brand livery"],
    ["storefront", "оформление витрины", "a branded storefront window display"],
    ["streetposter", "уличный постер", "a pasted street poster on a textured wall"],
    ["digitaldisplay", "реклама на цифровом экране", "the creative on a large digital display"],
    ["guerrillaad", "нестандартная наружная реклама", "an unconventional guerrilla outdoor placement"],
  ] },
  { group: "Мокапы", hint: "Показать дизайн в реальном контексте", items: [
    ["phonemockup", "визуал на экране телефона", "the design shown on a phone screen mockup"],
    ["laptopmockup", "страница на экране ноутбука", "the page shown on a laptop screen mockup"],
    ["tabletmockup", "дизайн на планшете", "the design on a tablet mockup"],
    ["instagrammockup", "пост в интерфейсе Instagram", "the post inside a social feed interface mockup"],
    ["telegrammockup", "публикация в интерфейсе мессенджера", "the post inside a messenger interface mockup"],
    ["packagingmockup", "дизайн на упаковке", "the design applied to product packaging"],
    ["bookmockup", "обложка на книге", "the cover on a physical book mockup"],
    ["magazinemockup", "дизайн в журнале", "the design on an open magazine spread"],
    ["tshirtmockup", "принт на футболке", "the print on a t-shirt mockup"],
    ["stationerymockup", "фирменный стиль на канцелярии", "the identity applied across stationery items"],
  ] },
  { group: "Формы и модели", hint: "Узнаваемые модели для сложных идей", items: [
    ["iceberg", "видимая и скрытая части темы", "an iceberg model: a small visible part above water, the bulk below"],
    ["pyramid", "иерархия уровней", "a pyramid of stacked levels from base to apex"],
    ["funnel", "этапы воронки", "a funnel narrowing through labelled stages"],
    ["matrix", "раскладка по двум осям", "a two-by-two matrix along two labelled axes"],
    ["venndiagram", "пересечение множеств", "a Venn diagram with a meaningful overlap"],
    ["spectrum", "шкала между крайностями", "a spectrum between two extremes"],
    ["ladder", "последовательность роста", "a ladder of ascending steps"],
    ["loop", "циклический процесс", "a closed loop cycle with no start or end"],
    ["ecosystem", "экосистема связей", "an ecosystem of interdependent parts"],
    ["constellation", "сеть взаимосвязанных точек", "a constellation of connected points"],
  ] },
  { group: "Истории и сценарии", hint: "Сторителлинг и последовательное повествование", items: [
    ["storyboard", "раскадровка сюжета", "a storyboard of sequential panels"],
    ["comicstrip", "история в формате комикса", "a comic strip with panels and speech bubbles"],
    ["herojourney", "путь героя", "the hero's journey drawn as a circular path"],
    ["dayinthelife", "один день из жизни", "a day in the life told through moments"],
    ["pov", "сцена от первого лица", "a first-person point of view scene"],
    ["scenebyscene", "история по сценам", "the story broken into distinct scenes"],
    ["transformation", "визуальная трансформация", "a visual transformation from one state to another"],
    ["problemsolution", "проблема и её решение", "a problem on one side, its solution on the other"],
    ["hookstoryoffer", "хук, история и предложение", "a hook, then a story, then an offer"],
    ["loopstory", "зацикленный сюжет", "a looping story where the end meets the beginning"],
  ] },
  { group: "Идеи и метафоры", hint: "Сделать абстрактную мысль яркой", items: [
    ["metaphor", "визуальная метафора идеи", "a visual metaphor for the idea"],
    ["analogy", "объяснение через аналогию", "the idea explained through a familiar analogy"],
    ["symbolism", "образ через символы", "the idea expressed through symbols"],
    ["visualpun", "визуальная игра слов", "a visual pun"],
    ["surrealconcept", "сюрреалистичная концепция", "a surreal conceptual image"],
    ["scalecontrast", "контраст масштаба", "a dramatic contrast of scale"],
    ["hybridobject", "гибрид двух объектов", "a hybrid of two unrelated objects fused into one"],
    ["impossibleobject", "невозможный объект", "an impossible object that cannot exist"],
    ["personification", "оживление предмета", "an inanimate object given life and character"],
    ["hiddenmeaning", "визуал со вторым смыслом", "an image with a second meaning hidden in it"],
  ] },
  { group: "Стиль и подача", hint: "Быстрый выбор художественного языка", items: [
    ["editorial", "редакционная журнальная подача", "editorial magazine art direction"],
    ["minimal", "чистый минималистичный стиль", "clean minimalist composition with generous white space"],
    ["boldtype", "акцент на крупной типографике", "oversized bold typography carrying the composition"],
    ["collage", "смешанная коллажная композиция", "a mixed-media collage composition"],
    ["papercut", "эффект вырезанной бумаги", "layered paper-cut craft with soft shadows"],
    ["clay", "мягкая пластилиновая 3D-подача", "soft clay-render 3D with rounded forms"],
    ["isometric", "изометрическая иллюстрация", "an isometric illustration"],
    ["blueprint", "чертёж на синем фоне", "a technical blueprint in white line on deep blue"],
    ["handdrawn", "рисованный от руки стиль", "a hand-drawn illustration with visible pen strokes"],
    ["dataviz", "выразительная визуализация данных", "an expressive data visualisation"],
  ] },
];

/** Команды одним списком: интерфейсу удобнее искать по плоскому. */
/**
 * Русские названия там, где само слово и есть то, что человек наберёт в поиске.
 *
 * Поиск идёт и по смыслу («скрытая» находит /iceberg), но «айсберг» — это не
 * описание, а имя модели, и набирают именно его.
 */
const COMMAND_ALIASES = {"iceberg": "айсберг", "pyramid": "пирамида", "funnel": "воронка", "matrix": "матрица", "venndiagram": "диаграмма Венна круги", "spectrum": "спектр шкала", "ladder": "лестница", "loop": "цикл петля", "ecosystem": "экосистема", "constellation": "созвездие", "storyboard": "раскадровка", "comicstrip": "комикс", "mindmap": "майндмэп карта мыслей", "roadmap": "роадмап дорожная карта", "timeline": "таймлайн хронология", "flowchart": "флоучарт блок-схема", "infographic": "инфографика", "diagram": "диаграмма", "carousel": "карусель", "checklist": "чеклист", "cheatsheet": "шпаргалка", "faq": "вопрос-ответ", "metaphor": "метафора", "analogy": "аналогия", "collage": "коллаж", "isometric": "изометрия", "blueprint": "блюпринт чертёж", "minimal": "минимализм", "editorial": "эдиториал", "dataviz": "датавиз графика данных", "anatomy": "анатомия", "xray": "рентген", "billboard": "билборд", "mockup": "мокап", "phonemockup": "мокап телефона", "laptopmockup": "мокап ноутбука", "versus": "версус", "pov": "пов от первого лица", "clay": "пластилин", "papercut": "бумага паперкат", "handdrawn": "от руки скетч", "process": "процесс", "workflow": "воркфлоу", "framework": "фреймворк", "systemmap": "карта системы", "transformation": "трансформация", "scenebyscene": "scenebysscene по сценам", "problemsolution": "problemssolution проблема решение"};

const COMMANDS = FORMAT_COMMANDS.flatMap((g) =>
  g.items.map(([id, why, prompt]) => ({
    id,
    group: g.group,
    name: "/" + id,
    why,
    aka: COMMAND_ALIASES[id] || "",
    prompt,
  }))
);

/**
 * Параметры генерации.
 *
 * Честная оговорка, без которой этот список вводит в заблуждение: у каждой
 * модели свой набор полей, и единого справочника, из которого его можно
 * вычитать, у шлюза нет. Поэтому здесь собрано то, что принимают почти все
 * модели изображений и видео, — а всё, что специфично для одной модели,
 * по-прежнему пишется в поле «дополнительные параметры» обычным JSON и
 * подмешивается поверх. Ни одно поле не отправляется пустым: незаполненное
 * просто не попадает в запрос, и модель работает со своими умолчаниями.
 */
const MODEL_FIELDS = {
  image: [
    { key: "aspect_ratio", name: "Пропорции", kind: "choice", options: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"], hint: "Форма кадра. 9:16 — вертикальная история, 1:1 — пост, 16:9 — обложка." },
    { key: "n", name: "Сколько вариантов", kind: "number", min: 1, max: 8, hint: "Больше вариантов — больше и стоимость." },
    { key: "negative_prompt", name: "Чего не должно быть", kind: "text", hint: "Текст, лишние руки, водяные знаки — перечислите через запятую." },
    { key: "seed", name: "Зерно", kind: "number", hint: "Одно и то же зерно с тем же промптом даёт тот же кадр. Пусто — каждый раз новый." },
    { key: "guidance_scale", name: "Строгость к промпту", kind: "number", step: 0.5, min: 1, max: 20, hint: "Выше — ближе к тексту и суше; ниже — вольнее и живее." },
    { key: "steps", name: "Шагов", kind: "number", min: 1, max: 100, hint: "Больше шагов — детальнее и дороже." },
    { key: "size", name: "Размер", kind: "choice", options: ["1K", "2K", "4K"], hint: "Сторона кадра: 1K — для ленты, 2K — печать и крупный экран, 4K — дороже и дольше, умеют не все модели." },
    { key: "output_format", name: "Формат файла", kind: "choice", options: ["png", "jpeg", "webp"], hint: "png — без потерь и с прозрачностью, jpeg — легче, webp — компромисс." },
  ],
  video: [
    { key: "aspect_ratio", name: "Пропорции", kind: "choice", options: ["16:9", "9:16", "1:1", "4:3", "21:9"], hint: "Форма кадра ролика. 9:16 — вертикальное видео." },
    { key: "duration", name: "Длительность, с", kind: "number", min: 1, max: 60, hint: "Модели обычно принимают только несколько значений — 4, 5, 8, 10." },
    { key: "resolution", name: "Разрешение", kind: "choice", options: ["480p", "720p", "1080p", "4k"], hint: "Чем выше, тем дороже и дольше. Для соцсетей хватает 1080p." },
    { key: "fps", name: "Кадров в секунду", kind: "number", min: 8, max: 60, hint: "24–30 — киношно и привычно; больше — плавнее и дороже." },
    { key: "negative_prompt", name: "Чего не должно быть", kind: "text", hint: "Текст, логотипы, лишние руки — перечислите через запятую." },
    { key: "seed", name: "Зерно", kind: "number", hint: "Повторяет тот же ролик при том же промпте." },
    { key: "with_audio", name: "Со звуком", kind: "flag", hint: "Умеют не все модели; у тех, кто не умеет, поле просто игнорируется." },
  ],
  audio: [
    { key: "duration", name: "Длительность, с", kind: "number", min: 1, max: 300, hint: "Сколько секунд звучания заказать." },
    { key: "voice", name: "Голос", kind: "text", hint: "Идентификатор голоса у той модели, которая его поддерживает." },
    { key: "format", name: "Формат", kind: "choice", options: ["mp3", "wav", "ogg"], hint: "mp3 — везде открывается, wav — без потерь и тяжелее." },
  ],
};

/**
 * Значения полей — в объект запроса.
 *
 * Пустые поля выбрасываются: отправить `seed: ""` хуже, чем не отправить
 * ничего, — модель на таком поле спотыкается, а человек видит невнятную ошибку
 * вместо картинки. Числа приводятся к числам по той же причине.
 */
function buildParams(type, values = {}) {
  const fields = MODEL_FIELDS[type] || [];
  const out = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (field.kind === "number") {
      const n = Number(String(raw).replace(",", "."));
      if (Number.isFinite(n)) out[field.key] = n;
    } else if (field.kind === "flag") {
      if (raw === true || raw === "true") out[field.key] = true;
    } else {
      out[field.key] = String(raw);
    }
  }
  return out;
}

/**
 * Стили, присланные с уже проверенными промптами.
 *
 * Строки взяты как есть — они опробованы на настоящих генерациях, и переписать
 * их «покрасивее» значило бы потерять ровно то, ради чего их записывали. Место
 * под предмет обозначается `[объект]` или `[PRODUCT]`; подставляется то, что
 * человек назвал сам.
 */
const MORE_STYLES = [
  {
    id: "luxury-campaign", name: "Кампейн модного дома",
    why:
      "Рекламный кадр дорогой марки: одно мягкое направленное освещение, глубокая тёплая тень, плёночное зерно и палитра из трёх цветов — " +
      "чёрный, шоколадная кожа, жемчуг. Герой не смотрит в камеру, и рядом с ним одно неожиданное существо или предмет — на этом контрасте всё и держится. " +
      "Формула короткая намеренно: модели изображений на длинных описаниях начинают плыть, и для этого стиля коротко работает лучше, чем подробно.",
    needsPhoto: false,
    prompt:
      "Luxury fashion campaign photograph. [объект], an unusual appearance, not looking at the camera, calm and relaxed. " +
      "Deep, warm interior shadow behind. Medium format film, single soft directional light, true grain, " +
      "palette of black, chocolate leather, and pearl. Trust as luxury. Indistinguishable from a real photograph. No lettering.",
  },
  {
    id: "dark-noir-deco", name: "Dark Noir Deco",
    why: "Лук мультсериального Бэтмена, скрещённый с нуаром ар-деко сороковых: горячий красный с одной стороны лица, ледяной синий с другой, и всё утопает в сияющем золоте. Работает и с референсом персонажа, и без него.",
    needsPhoto: true,
    prompt:
      "Repaint this photo in the \"Dark Noir Deco\" style — the exact look of 1990s animated-series superhero art " +
      "fused with 1940s Art Deco noir. Flatten everything into bold poster shapes — reduce the face, skin and " +
      "clothing to only 3-4 flat color zones, big smooth cel-shaded blocks, clean confident outlines. No fine " +
      "shading, no realistic texture, no 3D rendering, no airbrush gradients. A painterly animation still, not a photo. " +
      "LIGHTING — the key of this style: a hard two-color split — hot crimson-red on one side of the face and body " +
      "and cold steel-blue / cobalt on the other, almost no midtones. Let large areas collapse into deep solid black, " +
      "with only red, blue and gold lit planes emerging. " +
      "GLOW & GOLD — critical, push hard: flood the image with radiant light. Paint brilliant glowing golden-amber " +
      "light — blazing warm gold highlights on skin, hair edges, jewelry and any metal, glowing like molten gold. " +
      "Add bright glossy luminous rim highlights in electric-blue and hot gold along hair, shoulders, cheekbones and " +
      "fabric. Fill the dark background with sparkling golden and blue bokeh lights, warm candle-gold glints and hazy " +
      "neon glimmer. Strong light bloom around every bright source. Everything looks lit from within — radiant, " +
      "luminous, luxurious. Maximum saturation, extreme contrast, never washed out or pastel. " +
      "GEOMETRY: stylize faces and bodies into elegant angular planes — large, clean, sculpted facets, sharp cheekbone " +
      "and jaw planes, elongated graceful Deco proportions. " +
      "COMPOSITION: dramatic low camera angle looking up at the subject, dynamic diagonal tilt, large portrait framing " +
      "so the face reads clearly. " +
      "SUBJECT: keep each person's exact face, hairstyle, headwear, tattoos and accessories from the photo, and keep " +
      "correct gender likeness. HAIR: deep blue-black with rich cobalt reflections and glossy electric-blue and gold " +
      "highlight strands. LIPS: natural soft rosy-nude, no heavy makeup. " +
      "BACKGROUND: an elegant nocturnal Art Deco setting with strong depth and glowing golden light; simplify any room " +
      "or car interior into large flat geometric shapes, not realistic detail. " +
      "Glamorous, dangerous, mysterious noir mood. Rich saturated red-blue-and-gold palette on true black. " +
      "Gallery-quality Art Deco noir poster, razor-sharp linework, dramatic chiaroscuro.",
  },
  {
    id: "origami", name: "Фото + оригами",
    why: "Человек с фотографии сложен в фигуру оригами: плоская анатомия, печать в духе постеров семидесятых. Лицо, руки и обувь остаются фотографическими — всё остальное складывается из бумажной ленты.",
    needsPhoto: true,
    prompt:
      "Fold the person from the attached photo into an origami figure — flat-pack anatomy, 1970s screenprint poster. " +
      "Silhouette reads instantly as a clothed human: collar, sleeves, hem and trouser cut from the reference stay " +
      "recognizable; the folding happens inside that outline. The body is one flat strip of constant width folded like " +
      "a paper belt, all edges strictly vertical, horizontal or 45 degrees. Joints are miter folds — two slabs meeting " +
      "at a crisp diagonal seam. Seams shown only by a darker shade on the receding facet: no outlines, no shadows, no " +
      "depth. Bands wide and slab-like, never tapering or curving. Pick two or three body zones for dramatic folds — " +
      "accordion pleats, hairpin switchbacks, Z-folds — the rest of the body in long clean runs. " +
      "Photographic and untouched: the head with exact likeness, the oversized hands, the shoes. Nothing else is anatomy. " +
      "Dynamic action — striding, jumping, crouching, leaning, reaching — never standing still, holding [объект] in one " +
      "hand in an unusual way. Figure fills the canvas edge to edge, cropped by both sides, no margins. " +
      "Each garment piece one flat color from dusty pink, ochre, deep olive, oxblood, slate lavender, cream, teal, " +
      "mustard, with real material texture per piece — denim, felt, leather, corduroy. Risograph grain, halftone dots, " +
      "ink misregistration, matte. " +
      "Avoid: standing still, symmetry, curves, tapering limbs, shadows, 3D render, gradients, scenery, text, margins.",
  },
  {
    id: "paper-collage", name: "Бумажный коллаж по профессии",
    why: "Вертикальный скрапбук-коллаж: человек как вырезанная из бумаги наклейка, вокруг — предметы его профессии, дудлы и заголовок из журнальных букв. Под предмет подставьте профессию.",
    needsPhoto: true,
    prompt:
      "Vertical digital scrapbook collage on the theme \"[объект]\". Premium fashion editorial crossed with pop-art, " +
      "retro zine and DIY scrapbook. Use the uploaded photo as identity reference: keep the recognizable face, " +
      "realistic proportions and natural expression, looking straight at the camera; the face stays photorealistic with " +
      "no cartoon effect. " +
      "In the centre, the full-height figure as a paper cut-out sticker with a white outline, soft paper shadow and " +
      "light fibre texture; feet and shoes fully in frame, props never covering the silhouette. Clean fashion styling, " +
      "natural glam makeup, luminous skin, warm peach tint, subtle halftone only in the shadows. " +
      "Background: warm off-white textured paper with plenty of air and negative space, torn vintage paper fragments " +
      "without text, CMYK halftone accents behind the figure and in the corners. " +
      "A large heading across the top in magazine cut-out letters, each letter a different colour — black, red, blue, " +
      "cream, yellow, soft pink — crisp, even and readable. " +
      "Around the figure, the tools of the trade as paper stickers with white outlines and soft shadows. Add hand-drawn " +
      "doodles: arrows, sparkles, hearts, underlines, speech bubbles in black, blue, yellow and pink. " +
      "Palette: cream, black, red, blue, soft pink, warm peach. Premium handcrafted editorial collage, clean vertical " +
      "composition, sharp paper edges, soft shadows, high detail.",
  },
  {
    id: "crimson-heat", name: "Товар: Crimson Heat",
    why: "Премиальный рендер товара в глубоком красном: тёплый ключевой свет, оранжевый контровой, чёрно-кровавый градиент фона. Для карточек и рекламы.",
    needsPhoto: true,
    prompt:
      "Hyper-realistic premium 3D commercial render of [PRODUCT], floating in mid-air at a dynamic three-quarter angle " +
      "with a slight diagonal tilt, centered composition. Use the uploaded product as the exact subject, preserve its " +
      "shape, proportions, branding and label design precisely. Macro-level surface detail: micro-scratches, realistic " +
      "material texture, crisp edges. Dramatic deep-red mood: product lit with warm crimson key light and subtle orange " +
      "rim light, glossy reflections tinted red. Background: seamless vertical gradient from pure black at top to deep " +
      "blood-red at bottom. Soft ambient occlusion shadow beneath the object. Shot on a virtual 85mm lens, sharp focus " +
      "on the product. High-end advertising aesthetic, octane render quality, 8k. No text, no typography, no watermarks, " +
      "background completely empty.",
  },
  {
    id: "liquid-chrome", name: "Товар: Liquid Chrome",
    why: "Тот же рендер, но товар в зеркальном жидком хроме: студийные отражения, холодный серебряный контровой, графитовый градиент.",
    needsPhoto: true,
    prompt:
      "Hyper-realistic premium 3D commercial render of [PRODUCT], floating in mid-air at a dynamic three-quarter angle " +
      "with a slight diagonal tilt, centered composition. Use the uploaded product as the exact subject, preserve its " +
      "shape, proportions, branding and label design precisely. Macro-level surface detail: micro-scratches, realistic " +
      "material texture, crisp edges. Full mirror-polished liquid chrome treatment on the product, crisp studio " +
      "reflections, high-contrast speculars, subtle scratches catching light. Neutral white key light, cold silver rim " +
      "light. Background: seamless vertical gradient from pure black at top to dark graphite grey at bottom. Soft ambient " +
      "occlusion shadow beneath the object. Shot on a virtual 85mm lens, sharp focus on the product. High-end advertising " +
      "aesthetic, octane render quality, 8k. No text, no typography, no watermarks, background completely empty.",
  },
  {
    id: "iridescent-violet", name: "Товар: Iridescent Violet",
    why: "Голографическая плёнка с переливами в фиолетовый, розовый, бирюзовый и золото. Тот же свет и та же геометрия, что у двух предыдущих — серия собирается из них.",
    needsPhoto: true,
    prompt:
      "Hyper-realistic premium 3D commercial render of [PRODUCT], floating in mid-air at a dynamic three-quarter angle " +
      "with a slight diagonal tilt, centered composition. Use the uploaded product as the exact subject, preserve its " +
      "shape, proportions, branding and label design precisely. Macro-level surface detail: micro-scratches, realistic " +
      "material texture, crisp edges. Iridescent holographic finish on the product, oil-slick chrome reflections shifting " +
      "purple, pink, teal and gold. Background: seamless vertical gradient from pure black at top to deep electric violet " +
      "at bottom. Cool magenta rim light, soft ambient occlusion shadow beneath the object. Shot on a virtual 85mm lens, " +
      "sharp focus on the product. High-end advertising aesthetic, octane render quality, 8k. No text, no typography, no " +
      "watermarks, background completely empty.",
  },
  {
    id: "klimt", name: "Климт — золото и орнамент",
    why: "Золотые орнаменты, мозаика, роскошь. Для красоты, украшений, моды и премиальных визуалов.",
    prompt:
      "close-up luxury fashion portrait surrounded by intricate golden ornamental patterns, shimmering gold leaf " +
      "textures, geometric mosaics, deep black and warm amber accents, elegant elongated silhouette, decorative floral " +
      "motifs merging with the dress, rich flat ornamental background contrasted with realistic skin and face, sensual " +
      "sophisticated atmosphere inspired by Viennese Secession painting, high-fashion editorial, ultra detailed",
  },
  {
    id: "hopper", name: "Хоппер — кино и одиночество",
    why: "Большие окна, пустая улица, тёплый свет внутри против холодных синих теней снаружи. Для сторителлинга, отелей, ресторанов и атмосферных кадров.",
    prompt:
      "cinematic photograph of a lone figure inside a small late-night cafe, huge glass windows, empty street outside, " +
      "strong warm artificial light inside contrasting with cold blue evening shadows, minimalist composition, quiet " +
      "loneliness, geometric architecture, large negative space, restrained muted colors, 1940s American urban " +
      "atmosphere, narrative still frame inspired by American realist painting, realistic photography, subtle film grain",
  },
  {
    id: "magritte", name: "Магритт — один невозможный элемент",
    why: "Обычная сцена, в которой появляется что-то совершенно невозможное. Источник идей для концептуальной рекламы.",
    prompt:
      "minimalist surreal editorial image, an elegant figure in a black tailored suit standing in a completely ordinary " +
      "white room, the head replaced visually by a floating cloud while the body remains realistic, blue sky visible " +
      "through a rectangular doorway, clean geometry, restrained palette, mysterious conceptual symbolism, realistic " +
      "objects arranged in impossible combinations, sophisticated Belgian surrealism influence, high-end campaign photography",
  },
  {
    id: "hokusai", name: "Хокусай — графика и движение",
    why: "Монументальная волна, индиго и белый, резкие графические контуры поверх гиперреалистичной съёмки. Для моды, путешествий и динамичных концептов.",
    prompt:
      "modern fashion editorial on a dramatic Japanese coastline, monumental curling ocean wave rising behind the " +
      "subject, deep indigo blue and off-white palette, stylized rhythmic wave shapes, crisp graphic contours mixed with " +
      "hyperreal photography, strong diagonal composition, wind moving the clothes, distant mountain silhouette, " +
      "traditional Japanese woodblock visual language interpreted as a contemporary luxury campaign",
  },
  {
    id: "rousseau", name: "Руссо — сказочные джунгли",
    why: "Плотная растительность, гигантские листья, спрятанные животные, театральная перспектива. Для сюрреалистичных кадров с природной средой.",
    prompt:
      "surreal tropical fashion portrait inside an impossibly dense jungle, oversized leaves, exotic flowers, hidden " +
      "animals watching from between plants, deep emerald greens mixed with warm red and ochre accents, flattened " +
      "theatrical perspective, mysterious moonlight, sculptural couture dress, dreamlike naive tropical painting " +
      "atmosphere blended with realistic editorial photography",
  },
  {
    id: "bosch", name: "Босх — детали и максимальный сюр",
    why: "Сотни мелких сюжетов в одном кадре. Когда нужно изображение, которое рассматривают дольше пары секунд.",
    prompt:
      "surreal contemporary fashion scene in an enormous dreamlike garden filled with transparent spheres, strange " +
      "oversized fruits, miniature architectural towers, fantastical birds and impossible hybrid plants, an elegant " +
      "figure calmly walking through the chaotic environment, hundreds of tiny narrative details, bizarre dream " +
      "symbolism, medieval fantasy atmosphere transformed into hyperreal cinematic photography, extremely intricate " +
      "composition",
  },
  {
    id: "flir", name: "Тепловизор FLIR",
    why: "Ложные цвета теплового снимка с интерфейсом наблюдения. Машинная эстетика, а не художественная цветокоррекция.",
    needsPhoto: true,
    prompt:
      "Transform the image into an ultra realistic thermal infrared surveillance scan. Preserve original composition and " +
      "subject structure while converting the scene into authentic false-color thermal imaging. Use realistic FLIR " +
      "infrared color mapping where cold areas become deep navy, cobalt blue and cyan, while heat signatures become " +
      "bright yellow, orange and red. Maintain believable thermal gradients and heat distribution rather than random " +
      "rainbow coloring. Add soft thermal bloom and heat diffusion around warm areas with realistic infrared glow bleed. " +
      "Include subtle sensor noise, scan grain and digital interference to simulate real thermal camera hardware. Overlay " +
      "minimal surveillance UI elements including scanner corners, targeting reticle, detection boxes, telemetry text and " +
      "temperature readouts. The result should feel machine-generated and high-tech rather than artistic color grading. " +
      "Preserve silhouettes and geometry while removing natural photographic color.",
  },
  {
    id: "expired-film", name: "Просроченная плёнка",
    why: "Засветки по краю, сдвинутая химия, крупное зерно. Найденная плёнка из архива девяностых — драгоценная случайность.",
    needsPhoto: true,
    prompt:
      "Use the uploaded image as the only identity reference. Preserve the person's face, hairstyle, clothing, pose, body " +
      "proportions and accessories exactly. Transform the photo into a shot on decade-expired 35mm film with light leaks. " +
      "DEGRADATION: bold orange-red light leaks bleeding in from the frame edges, one diagonal flare streak crossing part " +
      "of the image, a burned amber edge on one side like the film caught fire in the canister. COLOR: unstable shifted " +
      "chemistry — magenta-drifted shadows, green-tinted midtones, sun-bleached faded highlights, heavy coarse grain, dust " +
      "specks and tiny scratches. MOOD: a lost tape from a 90s tour archive. " +
      "AVOID: clean exposure, accurate colors, digital sharpness, modern grading, sterile perfection.",
  },
  {
    id: "datamosh", name: "Datamosh — битый кадр",
    why: "Повреждённый цифровой кадр: пиксельные разрывы и цветовые призраки едят края, а лицо остаётся резким в центре хаоса.",
    needsPhoto: true,
    prompt:
      "Use the uploaded image as the only identity reference. Preserve the person's face, hairstyle, clothing, pose, body " +
      "proportions and accessories exactly — the face must stay clean and readable. Transform the photo into a corrupted " +
      "digital video frame. GLITCH: aggressive datamosh artifacts eating the EDGES and BACKGROUND of the frame — " +
      "horizontal pixel-sorted streaks, blocky macroblock smears dragging colors sideways, RGB channel split with red and " +
      "cyan ghost edges, scattered corrupted squares — while the subject's face and torso remain sharp and untouched in " +
      "the centre of the chaos. COLOR: oversaturated digital primaries in the glitched zones, normal exposure on the " +
      "subject. AVOID: glitch covering the face, film grain, analog VHS look, soft blur, muted colors.",
  },
  {
    id: "y2k-fisheye", name: "Фотосессия в стиле 90-х",
    why: "Фишай, искажённая перспектива, зернистая печать, сдвиг CMYK и прямая вспышка. Эстетика скейт-журнала девяносто девятого года.",
    needsPhoto: true,
    prompt:
      "Chaotic fisheye shot of the person from the reference throwing one hand toward the camera — fingers huge and " +
      "distorted in the foreground, palm and knuckles enlarged by the wide-angle glass — while the other hand holds " +
      "[объект] in a confident pose. Face pushed back by perspective, cocky expression, subtle smirk. " +
      "Shot on an ultra-wide 15mm fisheye lens, strong barrel distortion, exaggerated perspective, subject close to the " +
      "lens, dynamic tilted dutch angle, evenly exposed frame edges with no vignette and no dark corners. " +
      "Faded 90s / Y2K skater magazine editorial aesthetic, a 1999 spread: washed-out colors, low contrast, milky blacks, " +
      "muted cyan-magenta cast, heavy halftone print texture with visible CMYK dot pattern, xerox photocopy grain, scanned " +
      "magazine paper feel, subtle RGB channel misalignment, light scratches and dust. Direct on-camera flash freezing the " +
      "motion, harsh flat lighting, orange-to-white gradient backdrop fading from warm orange into creamy white. " +
      "No readable text, no brand logos.",
  },
  {
    id: "trendy-product-ad", name: "Рекламный ролик без тормозов",
    video: true,
    why: "Для видео: предельно частые склейки, необычные ракурсы, глитчи, смазы, зерно, анимация текста и вспышки-переходы. Товарная реклама для соцсетей, которая не даёт отвести взгляд.",
    prompt:
      "Trendy social media product ad: animate with extreme dynamic and extremely fast cinematic cuts, lots of extreme " +
      "camera motion in unusual camera angles, glitches, motion blur and vintage grain, imperfections and lots of text " +
      "animations, flash transitions, speed ramping, match cuts, whip-pan transitions, clone trails, echo effects, " +
      "hyper-zooms, parallax layer separation, morphing transitions, shaky handheld camera motion, flashing images, drone " +
      "camera, image stretch, product explosion collage, inverted colors, extreme sound effects, no music.",
  },
];

/** Всё, что можно подмешать в промпт, одним списком — для интерфейса. */
/** Стили одним списком. Порядок: сначала присланные, потом общие. */
const ALL_STYLES = [...MORE_STYLES, ...STYLES];

const KIT = {
  paces: PACES,
  cameraMoves: CAMERA_MOVES,
  shotAngles: SHOT_ANGLES,
  lighting: LIGHTING,
  styles: ALL_STYLES,
  commands: COMMANDS,
  commandGroups: FORMAT_COMMANDS.map((g) => ({ group: g.group, hint: g.hint })),
  fields: MODEL_FIELDS,
};

function byId(list, id) {
  return id ? list.find((x) => x.id === id) || null : null;
}

/**
 * Промпт целиком.
 *
 * Порядок кусков не случаен: сначала то, ЧТО в кадре (иначе модель начинает
 * рисовать приём вместо предмета), потом стиль, потом ракурс и свет, и только
 * потом движение камеры с темпом. Дизайн-система идёт последней и самой
 * жёсткой строкой — иначе модель считает её пожеланием.
 */
function buildPrompt({ base = "", style, camera, pace, angle, lighting, design, subject = "", command } = {}) {
  const parts = [];
  const body = String(base || "").trim();
  if (body) parts.push(body);

  // Команда формата идёт сразу за темой: она отвечает на вопрос «в каком виде
  // это показать», и до стиля с ракурсом.
  const cmd = byId(COMMANDS, command);
  if (cmd) parts.push(cmd.prompt);

  const st = byId(ALL_STYLES, style);
  if (st) {
    // В строке стиля бывает место для предмета: подставляем то, что человек
    // назвал сам, иначе в промпт уедет буквальное слово «[объект]».
    const what = String(subject || "").trim() || body.split(/[.,;]/)[0].trim() || "the subject";
    parts.push(st.prompt.replace(/\[объект\]/g, what).replace(/\[PRODUCT\]/g, what));
  }

  const an = byId(SHOT_ANGLES, angle);
  if (an) parts.push(an.prompt);

  const li = byId(LIGHTING, lighting);
  if (li) parts.push(li.prompt);

  const cam = byId(CAMERA_MOVES, camera);
  if (cam) {
    const pc = byId(PACES, pace);
    // Темп приклеивается к движению, а не живёт отдельной фразой: «плавно» без
    // указания, что именно плавно, модель относит к чему угодно.
    parts.push(pc ? `${cam.prompt}, ${pc.prompt}` : cam.prompt);
  }

  const tokens = String((design && design.description) || "").trim();
  if (tokens) {
    parts.push(
      "Strictly follow this design system — these are the only colours and typefaces allowed, " +
        "do not invent new ones:\n" + tokens
    );
  }
  return parts.join(". ").replace(/\.\s*\./g, ".").trim();
}

/** Короткая опись выбранного — чтобы человек видел, из чего собран промпт. */
function describeChoice({ style, camera, pace, angle, lighting, command } = {}) {
  const names = [];
  const push = (item, prefix) => item && names.push(prefix + item.name);
  push(byId(COMMANDS, command), "формат: ");
  push(byId(ALL_STYLES, style), "стиль: ");
  push(byId(SHOT_ANGLES, angle), "ракурс: ");
  push(byId(LIGHTING, lighting), "свет: ");
  const cam = byId(CAMERA_MOVES, camera);
  if (cam) {
    const pc = byId(PACES, pace);
    names.push("камера: " + cam.name + (pc ? ` (${pc.name.toLowerCase()})` : ""));
  }
  return names.join(" · ");
}

module.exports = {
  PACES,
  COMMAND_ALIASES,
  MORE_STYLES,
  ALL_STYLES,
  FORMAT_COMMANDS,
  COMMANDS,
  MODEL_FIELDS,
  buildParams,
  CAMERA_MOVES,
  SHOT_ANGLES,
  LIGHTING,
  STYLES,
  KIT,
  byId,
  buildPrompt,
  describeChoice,
};
