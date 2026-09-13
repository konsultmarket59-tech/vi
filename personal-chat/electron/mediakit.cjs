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
    { key: "aspect_ratio", name: "Пропорции", kind: "choice", options: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"] },
    { key: "n", name: "Сколько вариантов", kind: "number", min: 1, max: 8, hint: "Больше вариантов — больше и стоимость." },
    { key: "negative_prompt", name: "Чего не должно быть", kind: "text", hint: "Текст, лишние руки, водяные знаки — перечислите через запятую." },
    { key: "seed", name: "Зерно", kind: "number", hint: "Одно и то же зерно с тем же промптом даёт тот же кадр. Пусто — каждый раз новый." },
    { key: "guidance_scale", name: "Строгость к промпту", kind: "number", step: 0.5, min: 1, max: 20, hint: "Выше — ближе к тексту и суше; ниже — вольнее и живее." },
    { key: "steps", name: "Шагов", kind: "number", min: 1, max: 100, hint: "Больше шагов — детальнее и дороже." },
    { key: "output_format", name: "Формат файла", kind: "choice", options: ["png", "jpeg", "webp"] },
  ],
  video: [
    { key: "aspect_ratio", name: "Пропорции", kind: "choice", options: ["16:9", "9:16", "1:1", "4:3", "21:9"] },
    { key: "duration", name: "Длительность, с", kind: "number", min: 1, max: 60, hint: "Модели обычно принимают только несколько значений — 4, 5, 8, 10." },
    { key: "resolution", name: "Разрешение", kind: "choice", options: ["480p", "720p", "1080p", "4k"] },
    { key: "fps", name: "Кадров в секунду", kind: "number", min: 8, max: 60 },
    { key: "negative_prompt", name: "Чего не должно быть", kind: "text" },
    { key: "seed", name: "Зерно", kind: "number", hint: "Повторяет тот же ролик при том же промпте." },
    { key: "with_audio", name: "Со звуком", kind: "flag", hint: "Умеют не все модели; у тех, кто не умеет, поле просто игнорируется." },
  ],
  audio: [
    { key: "duration", name: "Длительность, с", kind: "number", min: 1, max: 300 },
    { key: "voice", name: "Голос", kind: "text", hint: "Идентификатор голоса у той модели, которая его поддерживает." },
    { key: "format", name: "Формат", kind: "choice", options: ["mp3", "wav", "ogg"] },
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

/** Всё, что можно подмешать в промпт, одним списком — для интерфейса. */
const KIT = {
  paces: PACES,
  cameraMoves: CAMERA_MOVES,
  shotAngles: SHOT_ANGLES,
  lighting: LIGHTING,
  styles: STYLES,
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
function buildPrompt({ base = "", style, camera, pace, angle, lighting, design, subject = "" } = {}) {
  const parts = [];
  const body = String(base || "").trim();
  if (body) parts.push(body);

  const st = byId(STYLES, style);
  if (st) {
    // В строке стиля бывает место для предмета: подставляем то, что человек
    // назвал сам, иначе в промпт уедет буквальное слово «[объект]».
    const what = String(subject || "").trim() || body.split(/[.,;]/)[0].trim() || "the subject";
    parts.push(st.prompt.replace(/\[объект\]/g, what));
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
function describeChoice({ style, camera, pace, angle, lighting } = {}) {
  const names = [];
  const push = (item, prefix) => item && names.push(prefix + item.name);
  push(byId(STYLES, style), "стиль: ");
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
