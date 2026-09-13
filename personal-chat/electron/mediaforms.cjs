/**
 * Заготовки промптов — целые сценарии, а не строки стиля.
 *
 * Стиль отвечает на вопрос «как это выглядит» и приклеивается к теме одной
 * фразой. Но лучшие ролики держатся не на стиле, а на УСТРОЙСТВЕ промпта:
 * сначала что неприкосновенно, потом что происходит по секундам, потом что
 * запрещено. Такой текст на тридцать строк не «дописывается к теме» — он и
 * есть промпт целиком, а тема подставляется внутрь него.
 *
 * Держать это в голове нельзя, а держать в переписке — значит каждый раз
 * листать чат и собирать по кускам. Поэтому заготовки лежат здесь целиком, а
 * места, куда подставляется своё, размечены и вынесены в поля: иначе человек
 * ищет «[DURATION]» глазами посреди английского текста и половину пропускает.
 *
 * Английский — не поза: почти все модели изображений и видео обучены на
 * английских описаниях, и перевод на русский стоит заметной части точности.
 * Пояснения при этом русские — выбирают по ним.
 */

const TEMPLATES = [
  {
    id: "camera-path",
    name: "Камера по нарисованной линии",
    kind: "video",
    needsPhoto: true,
    why:
      "Вы рисуете поверх картинки линию с точкой и стрелками — и она читается как траектория полёта камеры, а не как объект в кадре. " +
      "Самый короткий способ объяснить модели сложный облёт: показать его, а не описать словами. " +
      "Первый кадр остаётся точь-в-точь исходной картинкой, линия при этом нигде не появляется.",
    slots: [
      { key: "DURATION", name: "Длительность, с", hint: "Столько же, сколько закажете у модели: 5, 8, 10.", sample: "8" },
      {
        key: "MEDIUM AND ERA", name: "Медиум и эпоха",
        hint: "Чем снято или написано исходное изображение: 35mm film photograph, Renaissance oil painting, anime cel, 3D render.",
        sample: "35mm film photograph",
      },
      {
        key: "OPTIONAL — ADDED ELEMENT", name: "Что открывается по ходу (необязательно)",
        hint: "То, чего нет в первом кадре, но что камера находит. Пусто — блок выкидывается целиком.",
        sample: "",
        block: true,
      },
      { key: "SOUND", name: "Звук", hint: "Только шумы, без музыки: faint room tone, wind, distant murmur.", sample: "faint room tone, distant wind" },
    ],
    body: `FIRST FRAME: exactly the reference image, full composition, untouched — but WITHOUT any drawn line, arrow, dot or marking. The coloured path drawn on the image is a DIRECTOR'S ANNOTATION, not part of the scene. It is never rendered, never visible, never treated as an object, never lit and never reflected. Remove it completely from every single frame.

READ THE DRAWN PATH AS THE CAMERA MOVE. The solid dot marks where the camera starts. The arrowheads mark the direction of travel. The line marks the exact trajectory the camera flies through the scene, in three dimensions — where the line passes in front of an object the camera is near, where it passes behind an object the camera is far, where it rises in frame the camera gains height, where it drops in frame the camera descends. The camera is already easing into motion from the very first frame. It never holds and never hovers.

THE REFERENCE IMAGE IS A REAL 3D SPACE, not a flat picture. Read the depth: what is foreground, what is midground, what is background, what is behind what. Reconstruct the parts of the space the frame doesn't show — the sides and backs of subjects, the ground beneath them, the environment continuing past the edges of frame — inferring them from the light, perspective, materials and style already present. Everything invented must match the original exactly in lighting direction, colour palette, texture, medium and era.

PRESERVE EVERYTHING IN THE IMAGE EXACTLY: every subject, face, body, pose, expression, garment, prop, surface, structure and background element, in the same position, at the same scale, in the same layout, with the same proportions. Same light direction, same colour grade, same texture, same medium, same grain. Faces never change. Nothing is added, removed, restyled or replaced. Every figure keeps exactly the pose, clothing and coverage shown in the reference.

CAMERA, one unbroken [DURATION] second move, no cuts, following the drawn path from frame one to final frame:

The camera traces the entire drawn line at an even, unhurried pace, spending the full duration on the path and arriving at the end of the line exactly as the shot ends. It keeps the main subject anchored in frame throughout, reframing naturally as the geometry changes. It moves through real space with real parallax — near objects sweeping past the lens fast, far objects drifting slowly. Depth layers separate visibly and continuously.

IF THE DRAWN PATH RETURNS TO ITS STARTING DOT: the move closes the loop and the final frame matches the first frame exactly — same angle, same height, same distance, same layout — still drifting gently as it settles rather than snapping into place.

IF THE DRAWN PATH ENDS SOMEWHERE ELSE: the camera settles into a deliberate, composed final framing at the end of the line and the move decays into a slow drift. The shot ends still breathing, not frozen.

CAMERA FEEL: real drone or crane operated by a human, not a CG rail. Subtle handheld float, low-amplitude gimbal drift, tiny lateral corrections, slow roll into every bank, uneven velocity with the middle of the move faster than the beginning and the end. Organic and breathing. Not robotic, not perfectly linear, not glassy. The move is one smooth continuous arc — it never reverses direction, never pauses and never crosses back over itself.

MOTION IN THE SCENE — read the image and animate ONLY what would truly be moving, at the intensity the image implies:
- Anything painted, drawn or photographed mid-action continues that action subtly and in place — a raised arm holds with faint tremor, taut rope or fabric carries strain, a mid-stride figure holds the stride.
- Anything at rest stays at rest. Nobody walks, turns, gestures or changes expression unless the image clearly shows them doing it.
- Environmental motion runs continuously and softly: drifting cloud, haze, smoke, dust in light, rippling water, swaying foliage, flickering flame, falling snow or rain, fabric and hair stirring, birds far off.
- Light behaves live: slow shifts across surfaces, gentle flicker on flame-lit areas, atmosphere thickening and thinning with depth.
- Micro-parallax between every depth layer at all times.
- No new characters, objects, vehicles, animals or light sources ever appear. No morphing, warping, stretching or reshaping of faces, hands or bodies.

[OPTIONAL — ADDED ELEMENT: EXISTS IN THE SCENE FROM FRAME ONE and is simply outside the opening framing, so the camera discovers it rather than spawning it, rendered in the same style, palette and light as the rest of the image — ]

STYLE: [MEDIUM AND ERA], fully preserved. Cinematic, 24fps, shallow depth of field with focus riding the nearest subject, filmic grade true to the original palette, fine grain, no colour shift, no stylistic drift.

NEGATIVE: no drawn line, no arrow, no dot, no coloured marking, no path overlay, no UI, no text, captions, watermarks, logos or on-screen writing. No cuts, no jump, no teleport, no camera reversal, no flicker, no morphing faces, no extra limbs or fingers, no duplicated subjects, no style change.

AUDIO: no music, foley only — [SOUND].`,
  },
  {
    id: "multicam-recut",
    name: "Пересборка дубля многокамерно",
    kind: "video",
    needsPhoto: false,
    why:
      "Один снятый дубль превращается в монтаж с нескольких камер: тот же человек, та же речь, тот же свет — меняется только точка съёмки. " +
      "Модель не переигрывает сцену и не перекладывает звук, а пересматривает её с новых мест, как будто снимала бригада. " +
      "Главное здесь — таблица: число планов и порядок камер не выбираются на глаз, а берутся по длине исходника и по тому, идёт герой или стоит.",
    slots: [
      { key: "SOURCE", name: "Имя исходного видео", hint: "Как вы зовёте приложенный файл в промпте. По умолчанию @video1.", sample: "@video1" },
    ],
    body: `FORMAT: A multi-camera edit of one continuous take. The number of shots and the camera order are NOT chosen freely — they are looked up in the ROUTER below according to the measured duration of [SOURCE] and the movement mode detected in STEP 2. Camera movement is permitted ONLY where this prompt explicitly grants it. Do not use fewer shots than the router specifies.

TASK: [SOURCE] is the source take. Do not re-perform it and do not re-time it. Re-observe the exact same performance from a set of new camera positions, as if a full camera crew had covered the original take simultaneously, and cut between them. The subject's performance, the environment, the wardrobe and the lighting are fixed. Only the point of view changes.

STEP 1 — MEASURE THE SOURCE: Read the exact duration of [SOURCE] in seconds. Read the speech rhythm: sentence boundaries, breaths, pauses, emphasis beats. Read the subject, wardrobe, hair, skin, props, background geometry, lens character, grain and colour science and keep them pixel-consistent in every shot.

STEP 2 — DETECT THE MOVEMENT MODE. This decision comes before everything else.
Look at whether the subject physically travels through space in [SOURCE].
MODE STATIC — the subject is seated or standing on one spot. His body stays at the same coordinates for the whole take. Only his head, hands and torso move.
MODE MOVING — the subject walks, strolls, paces or otherwise travels through space while speaking. His position in the world changes over the duration of the take.
If in doubt, choose MODE STATIC. A wrong movement decision is the single most damaging error in this task.

STEP 3 — CLASSIFY THE LOCATION.
TYPE A — office, business centre, meeting room or lobby with a window wall or large windows.
TYPE B — cafe, restaurant, bar or coworking space with a street-facing window.
TYPE C — open air: street, pavement, terrace, rooftop, courtyard, park, embankment.
TYPE D — enclosed room with no windows and no view outside.
Now combine STEP 2 and STEP 3 to select exactly one of three rigs:
MODE STATIC + TYPE D  -> RIG 1, ENCLOSED ROUTER. The camera never moves and never leaves the room.
MODE STATIC + TYPE A, B or C -> RIG 2, OPEN ROUTER. Interior cameras never move; only the exterior and drone cameras may move.
MODE MOVING (any type) -> RIG 3, MOVING ROUTER. Motivated camera movement is unlocked.

=== THE GOLDEN RULE OF MOVEMENT ===
Camera movement is never decorative and never random. A camera may move for exactly two reasons: because the subject is moving and the camera is keeping pace with him, or because the shot is an aerial one. In every other case the camera is a locked-off tripod. There is no such thing as a free-floating drift, a random zoom or a sudden reframe in this edit. Every move runs at a constant speed, in a single axis, for the whole duration of its shot, with a gentle ease in and ease out. One shot never contains two different moves. No move ever accelerates, stutters, overshoots or corrects itself.

=== RIG 1 AND RIG 2 — STATIC SUBJECT (CAM 1 to CAM 12) ===
CAM 1 — 35mm, eye level, 0 degrees, medium shot waist-up, subject looking directly into this lens. HOME.
CAM 2 — 50mm, eye level, 45 degrees right, medium close-up chest-up, three-quarter profile.
CAM 3 — 50mm, chest height looking slightly up, 45 degrees left, medium close-up.
CAM 4 — 85mm, eye level, 90 degrees right, close-up, clean side profile.
CAM 5 — 24mm, raised 70cm above eye level and angled 25 degrees down, 20 degrees right, wide shot showing the full room.
CAM 6 — 85mm, slightly above eye level, 70 degrees left, close-up. Reserved for the strongest line.
CAM 7 — 24mm, eye level, 25 degrees left, wide master shot at distance.
CAM 9 — THE BRIDGE. 28mm, eye level, 60 degrees right, deep wide from the far side of the space with the window and its daylight fully in frame beside the subject, plus a foreground layer in the near field such as a desk edge, monitor, table, cup or chair back. For TYPE C, frame the horizon and the surrounding architecture instead of a window.
CAM 10 — 35mm, static, OUTSIDE the location on the other side of the glass, a few metres away, at the same height and floor level, shooting back in. The subject is still recognizable behind the window, the outside world reflects faintly across the glass, the interior reads darker than the exterior. For TYPE C use 85mm from far back with long-lens compression and a soft out-of-focus foreground.
CAM 11 — 24mm, drone hovering outside at the subject's level, roughly twelve metres from the facade, performing ONE slow lateral drift at constant speed. The subject is a small figure behind the glass. For TYPE B this may instead be a static position across the street with the full storefront in frame.
CAM 12 — 24mm, drone high above and away, performing ONE slow rise at constant speed. The whole building or location and the city around it, the subject no longer identifiable, his voice continuing as voice-over.
CAM 1 to CAM 9 are static shots, locked off cameras, tripod-mounted: no dolly, no zoom, no push in, no pull back, no pan, no tilt, no crane, no orbit, no handheld. Inside the location the frame never changes size within a shot. Only CAM 10, CAM 11 and CAM 12 may move.

=== RIG 3 — MOVING SUBJECT (WCAM 1 to WCAM 9, DRONE 1 to DRONE 3) ===
Every tracking camera holds a CONSTANT distance from the subject and matches his walking speed exactly. The subject never drifts toward or away from the lens inside a shot unless the shot is WCAM 8.
WCAM 1 — 35mm, eye level, directly in front, gimbal travelling backwards ahead of him at exactly his walking speed, constant distance, medium shot waist-up, subject looking into this lens. HOME of the moving mode.
WCAM 2 — 50mm, eye level, 45 degrees front-right, tracking alongside at matched speed and constant distance, medium close-up chest-up, three-quarter profile.
WCAM 3 — 85mm, eye level, full lateral profile, tracking sideways at matched speed, close-up, foreground elements passing between camera and subject and briefly veiling him.
WCAM 4 — 24mm, lowered to knee height, travelling backwards ahead of him at his speed, low wide angle, his feet and the ground surface prominent in the lower frame.
WCAM 5 — 50mm, shoulder height, behind and slightly left of the subject, following at matched speed, medium shot over the shoulder revealing what he is walking toward.
WCAM 6 — 85mm, eye level, STATIC locked-off camera planted on the ground. The subject walks into frame from a distance, crosses it and passes the lens. The camera itself does not move at all — only the subject moves through the frame.
WCAM 7 — 35mm, eye level, ONE slow arc of 40 to 60 degrees around the subject at constant radius and constant speed while he keeps walking, the background sweeping behind him with parallax.
WCAM 8 — THE ONLY PUSH-IN IN THE ENTIRE EDIT. 50mm, eye level, travelling ahead of the subject while closing the distance very slightly at constant speed, from medium shot to medium close-up. One single size step and no more. This is a real change of distance, never a zoom, and it happens at most once in the whole video.
WCAM 9 — THE BRIDGE. 24mm, eye level, STATIC locked-off wide from across the street or the open space, the subject small in frame walking through the environment, the full location and sky visible around him. This shot must precede the first aerial shot.
DRONE 1 — 24mm, drone eight metres above and slightly behind the subject, angled 40 degrees down, following him at his exact walking speed. One constant-speed follow and nothing else.
DRONE 2 — 24mm, drone directly overhead looking straight down, performing ONE slow rise at constant speed while he keeps walking below, the street geometry and his shadow opening out beneath him.
DRONE 3 — 24mm, drone high above the location, performing ONE slow rise or one slow pull away at constant speed, the subject a tiny figure in the wider city or landscape, his voice continuing as voice-over.

STEP 4 — ROUTER. Match the measured duration to one line of the router belonging to your selected rig, and use that camera order exactly, in that order, with no substitutions and no omissions.

ENCLOSED ROUTER — RIG 1:
6 to 8 seconds: exactly 4 shots — CAM 1, CAM 2, CAM 5, CAM 7.
9 to 11 seconds: exactly 5 shots — CAM 1, CAM 2, CAM 5, CAM 4, CAM 1.
12 to 14 seconds: exactly 6 shots — CAM 1, CAM 2, CAM 5, CAM 4, CAM 1, CAM 7.
15 to 17 seconds: exactly 7 shots — CAM 1, CAM 2, CAM 5, CAM 4, CAM 1, CAM 6, CAM 7.
18 to 21 seconds: exactly 9 shots — CAM 1, CAM 2, CAM 5, CAM 4, CAM 1, CAM 3, CAM 6, CAM 2, CAM 5.
22 to 25 seconds: exactly 11 shots — CAM 1, CAM 2, CAM 5, CAM 4, CAM 1, CAM 3, CAM 7, CAM 6, CAM 5, CAM 1, CAM 7.
26 to 30 seconds: exactly 13 shots — CAM 1, CAM 2, CAM 5, CAM 4, CAM 1, CAM 3, CAM 7, CAM 2, CAM 5, CAM 6, CAM 4, CAM 3, CAM 7.

OPEN ROUTER — RIG 2:
6 to 8 seconds: exactly 4 shots — CAM 1, CAM 2, CAM 9, CAM 12.
9 to 11 seconds: exactly 5 shots — CAM 1, CAM 2, CAM 5, CAM 9, CAM 12.
12 to 14 seconds: exactly 6 shots — CAM 1, CAM 2, CAM 9, CAM 10, CAM 1, CAM 12.
15 to 17 seconds: exactly 7 shots — CAM 1, CAM 2, CAM 9, CAM 10, CAM 6, CAM 1, CAM 12.
18 to 21 seconds: exactly 9 shots — CAM 1, CAM 2, CAM 5, CAM 9, CAM 10, CAM 11, CAM 1, CAM 2, CAM 12.
22 to 25 seconds: exactly 11 shots — CAM 1, CAM 2, CAM 5, CAM 9, CAM 10, CAM 11, CAM 1, CAM 2, CAM 6, CAM 7, CAM 12.
26 to 30 seconds: exactly 13 shots — CAM 1, CAM 2, CAM 5, CAM 4, CAM 1, CAM 9, CAM 10, CAM 11, CAM 1, CAM 6, CAM 2, CAM 5, CAM 12.

MOVING ROUTER — RIG 3:
6 to 8 seconds: exactly 4 shots — WCAM 1, WCAM 2, WCAM 9, DRONE 3.
9 to 11 seconds: exactly 5 shots — WCAM 1, WCAM 8, WCAM 6, WCAM 9, DRONE 3.
12 to 14 seconds: exactly 6 shots — WCAM 1, WCAM 8, WCAM 6, WCAM 9, DRONE 1, DRONE 3.
15 to 17 seconds: exactly 7 shots — WCAM 1, WCAM 8, WCAM 6, WCAM 9, DRONE 1, WCAM 1, DRONE 3.
18 to 21 seconds: exactly 9 shots — WCAM 1, WCAM 2, WCAM 6, WCAM 9, DRONE 1, DRONE 2, WCAM 1, WCAM 4, DRONE 3.
22 to 25 seconds: exactly 11 shots — WCAM 1, WCAM 2, WCAM 6, WCAM 5, WCAM 9, DRONE 1, DRONE 2, WCAM 1, WCAM 8, WCAM 4, DRONE 3.
26 to 30 seconds: exactly 13 shots — WCAM 1, WCAM 2, WCAM 6, WCAM 5, WCAM 7, WCAM 9, DRONE 1, DRONE 2, WCAM 1, WCAM 8, WCAM 4, WCAM 5, DRONE 3.

STEP 5 — TIMING. Divide the duration across the shots so that the first shot is the longest, wide and aerial shots run slightly longer than close-ups, no shot is shorter than 1.5 seconds and no shot is longer than 4 seconds. Place every cut on a natural speech pause, a sentence end or a breath, never mid-word and never in the middle of a fast head turn or a gesture apex. State each shot's in and out timecode explicitly and close each one with a hard cut.

GOING AERIAL: The camera may only leave ground level through the bridge shot — CAM 9 in RIG 2, WCAM 9 in RIG 3 — and never directly from a close-up. Once airborne the shots move outward in a strict ladder: still recognizable, then small in frame, then no longer identifiable. The camera returns to ground level only by cutting back to the home camera, CAM 1 or WCAM 1. The exterior world must match exactly what is visible in [SOURCE]: same location, same time of day, same weather, same quality and direction of daylight, same architecture and same city. Do not invent a different skyline, a different season or a different sky. On aerial shots the subject's face may be small or veiled, so readable lip-sync is not required there, but his body language, walking rhythm and gestures must still match [SOURCE] at those exact timecodes.

MOVEMENT CONTINUITY — RIG 3 ONLY: The subject's walking direction, walking speed and stride are identical to [SOURCE] at every timecode. He never changes direction, never stops and never starts unless he does so in the source. The environment he walks through is a single continuous space: what is behind him in one shot is what he came from, what is ahead of him is where he is going. Across a cut he must never teleport to a different street, a different building or a different stretch of pavement. Any pedestrians, traffic or background activity behave consistently from shot to shot.

EDIT GRAMMAR: Never place the same camera on two consecutive shots. Never place two close-ups back to back. Never follow a moving camera with another moving camera travelling in the opposite direction. Alternate camera-right and camera-left positions to build rhythm. Return to the home camera after every excursion into the air. In RIG 3, at least one shot in every sequence must be a static planted camera — WCAM 6 or WCAM 9 — so that the movement of the others reads as a deliberate choice rather than as constant drift.

EYELINE: In [SOURCE] the subject looks at one fixed point relative to himself — the position the original lens occupied, directly in front of his face. In RIG 1 and RIG 2 that point is fixed in world space and the gaze stays locked on it from every camera, so only CAM 1 reads as direct-to-lens and the off-axis cameras read as three-quarter or profile eyelines. In RIG 3 that point travels with him as he walks, so he reads as direct-to-lens on WCAM 1 and WCAM 8, and as three-quarter, profile or from-behind on the others. He never turns to acknowledge a new camera and never acknowledges the drone.

PERFORMANCE: Frame-identical to [SOURCE] at every timecode. Same gestures, same blinks, same head movements, same micro-expressions, same mouth shapes, same stride. Nothing added, removed, re-timed, looped or frozen. One continuous timeline across the full duration — the cuts change viewpoint only, never the moment in time. The first frame of each shot is the direct temporal continuation of the last frame of the previous shot.

OPTICS AND PHYSICS: Perspective, compression and depth of field change correctly with each camera's focal length and distance — 24mm and 28mm show more space and more perspective spread, 85mm compresses and isolates. Motion blur and depth of field respond correctly to each camera's own movement and to the subject's movement. The cameras are physical objects: they never clip through the subject, walls, furniture, glass, vehicles or the ground, and never sit closer than a real lens could. No face warping on the wide lenses.

LIGHTING: The light is emitted by the location, not by the camera. Key, fill and rim on the face redistribute correctly for each new angle and shadows fall in the physically correct direction, but the light sources themselves never move, never change colour temperature and never change intensity. Outdoors the sun stays in the same position in the sky for the whole edit. No relighting, no time-of-day shift, no weather change. Exposure and white balance are matched across every camera.

AUDIO: Carry the audio track of [SOURCE] over verbatim, in full, in sync, unchanged. Do not regenerate, do not re-voice, do not re-time, do not denoise, do not add music, do not add sound effects, do not add street noise, wind, footsteps or room tone. Lip movement follows the original recorded audio frame by frame on every ground-level camera.

NEGATIVE: no zoom, no digital zoom, no crop-scale, no push in other than the single WCAM 8 shot, no camera movement when the subject is static, no unmotivated drift, no floating camera, no handheld shake, no two consecutive close-ups, no repeating the same camera twice in a row, no cut shorter than 1.5 seconds, no using fewer shots than the router specifies, no cutting from a close-up straight to an aerial shot, no skipping the bridge shot, no camera accelerating or decelerating mid-shot, no two different moves inside one shot, no orbiting drone, no whip pan, no subject changing walking direction or speed, no teleporting to a different street across a cut, no exterior world that contradicts the source, no invented skyline, no camera passing through glass, no new dialogue, no re-voicing, no added music, no added ambience, no lip-sync drift, no face morphing, no identity change, no wardrobe change, no background change, no relighting, no weather change, no time-of-day change, no time jump, no loop, no rewind, no freeze frame, no speed ramp, no slow motion, no dissolve, no transition effect, no text, no captions, no subtitles, no logo, no watermark, no timecode, no letterboxing.`,
  },
  {
    id: "pov-throw",
    name: "Селфи-POV с броском телефона",
    kind: "video",
    needsPhoto: true,
    why:
      "Ролик снят целиком «изнутри телефона»: герой снимает себя, потом бросает телефон, съёмка продолжается из летящего аппарата, " +
      "а финал играется в кадре, повёрнутом на 90 градусов, — как будто телефон упал набок. " +
      "Приём держится на двух жёстких запретах: телефон не виден ни одного кадра и финал не выравнивается. Без них модель сваливается в обычный ролик от третьего лица.",
    slots: [
      { key: "HERO", name: "Герой", hint: "Внешность берётся из референса — здесь только имя-опора. Например: the woman from reference image 1.", sample: "the woman from reference image 1" },
      { key: "PLACE", name: "Место и свет", hint: "Где и в какое время. Например: a Japanese garden at dusk, golden hour fading into blue evening, cherry blossom petals drifting.", sample: "" },
      { key: "OPENING", name: "Что делает в начале", hint: "Одно понятное действие на первые секунды: leans in to smell the blossoms; adjusts her collar.", sample: "" },
      { key: "FINALE", name: "Финальная сцена", hint: "Что видно в упавшем телефоне. Герой к нам спиной, в центре кадра.", sample: "" },
      { key: "DURATION", name: "Длительность, с", hint: "Столько же, сколько закажете у модели.", sample: "14" },
    ],
    body: `The ENTIRE video is ONE single continuous take in 3:4 vertical format from the first frame to the last — the aspect ratio never changes; only the phone's physical orientation changes when it lands. Total length [DURATION] seconds.

TWO ABSOLUTE RULES ABOVE EVERYTHING ELSE:
(1) The video is 100% first-person POV shot FROM the phone's own front camera at every single moment, including the throw and the whole flight — the phone, or any recording device, must NEVER be visible in the frame, not for a single frame; no external or third-person view of the flying phone ever exists. During the flight we see only what the lens sees: the spinning world, never the device itself.
(2) After the phone lands, the entire final scene is ROTATED 90 DEGREES SIDEWAYS inside the vertical frame and stays sideways until the very last frame — never upright, never level.

THE HERO: [HERO]. Take her entire appearance 100% from the reference — face, hair, skin, make-up, jewellery and full outfit exactly as shown, never altered, never redesigned. Strictly lock this person's face, identity and clothing across the whole video.

LOCATION: [PLACE].

OPENING — handheld selfie POV: the hero holds the phone in her outstretched hand, filming herself from a THREE-QUARTER front-side angle — her face and upper body seen at a 45-degree angle, not a flat profile. [OPENING] Her gaze never goes into the lens. Then her eyes go WIDE and her face lights up with genuine SURPRISE and wonder, mouth opening in an amazed gasp, as she spots something incredible far ahead beyond the frame.

THE THROW — same continuous POV, no cut: her arm lowers the phone smoothly DOWN, then, still amazed, she deliberately and intentionally THROWS the PHONE away through the air with a sharp arm swing. From this instant the footage continues strictly FROM INSIDE THE FLYING PHONE — pure realistic POV of the front lens itself: the frame tumbles end over end, sky, surroundings and ground whirling past in heavy realistic motion blur, wind roaring in the microphone, brief smeared glimpses of the hero below. At no point does the shot cut away to show the phone flying — we ARE the phone. Then the ground rushes in, a realistic jolt of impact, and the phone settles LYING ON ITS SIDE on the ground, tilted exactly 90 degrees, the image snapping still and sharp.

THE CLIMAX — the fallen phone's fixed frame, the signature of the whole video, it must be exact: the frame is still 3:4 vertical, but because the phone lies flat ON ITS SIDE, the ENTIRE SCENE INSIDE THE FRAME IS ROTATED 90 DEGREES — the horizon line runs VERTICALLY along the long axis of the frame, sky on one side edge and ground on the other, everything appearing lying sideways: a widescreen composition that only looks upright if you physically tilt your phone 90 degrees. Never render this final scene upright or level — it stays sideways from the moment of landing to the last frame.

Within this sideways frame: [FINALE] The hero is seen from behind, positioned EXACTLY IN THE CENTER of the composition and staying centered for the whole shot, her outfit clearly recognizable, hair moving in the breeze. The camera does not move at all — it is a phone lying on the ground. Only the scene inside it lives.

STYLE: photoreal, natural handheld camera character, real phone-lens optics with slight wide-angle distortion and real rolling-shutter behaviour during the flight, natural light only, fine realistic grain.

AUDIO: diegetic only — ambient room tone or outdoor air, the rush of wind during the flight, the dull knock of the phone landing, then the quiet of the location. No music, no voiceover, no narration.

NEGATIVE: no visible phone, no visible hand holding a phone in the flight, no third-person shot of the flying phone, no cut, no dissolve, no transition, no aspect-ratio change, no upright or levelled final scene, no camera movement after landing, no text, captions, subtitles, watermarks or logos, no face morphing, no identity change, no wardrobe change, no extra fingers, no duplicated subjects, no fade to black.`,
  },
  {
    id: "campaign-film",
    name: "Кампейн-ролик из одного кадра",
    kind: "video",
    needsPhoto: true,
    why:
      "Рекламный ролик модного дома, собранный из одной готовой фотографии: семь планов, одно движение героя, один превращающийся предмет. " +
      "Ценность — в устройстве: сначала перечислено, что неприкосновенно (герой, свет, интерьер), потом посекундная раскадровка, потом запреты. " +
      "Свет здесь объявлен неподвижным отдельным пунктом: без этого модель начинает водить лучом по лицу, и рекламный кадр превращается в клип.",
    slots: [
      { key: "SUBJECT", name: "Герой и одежда", hint: "Всё берётся из референса — здесь короткая опора: a male model in a brown leather waistcoat over a white shirt.", sample: "" },
      { key: "MOTIF", name: "Главный предмет сцены", hint: "То, что живёт в кадре рядом с героем: a very large red snake, glossy scarlet scales, muscular and heavy.", sample: "" },
      { key: "SET", name: "Интерьер", hint: "Место, одно и то же во всех планах: a dark 1970s wood-panelled bathroom with a brass-framed mirror above a white sink.", sample: "" },
      { key: "LIGHT", name: "Единственный источник света", hint: "Прямо назвать его и сказать, что он неподвижен: a warm strip light above the mirror.", sample: "" },
      { key: "PALETTE", name: "Палитра", hint: "Три-четыре цвета: mahogany brown, oxblood leather, deep black, scarlet.", sample: "" },
      { key: "MOVE", name: "Единственное движение героя", hint: "Одно, медленное: raises one open palm to the height of his stomach and lowers his eyes to it.", sample: "" },
      { key: "TURN", name: "Превращение", hint: "Во что превращается предмет — одним непрерывным морфом, без вспышек и искр.", sample: "" },
      { key: "DURATION", name: "Длительность, с", hint: "Под неё считается раскадровка.", sample: "15" },
      { key: "SOUND", name: "Звук", hint: "Только шумы сцены: the dry rasp of scales over leather, a single drip from the tap, a low sub-bass drone.", sample: "" },
    ],
    body: `CREATIVE MAPPING
The reference image fixes the hero's appearance (face, hair, body), the wardrobe, the set and the main object. Exact match to the reference — no redesign. Identity, styling and set stay stable across all 7 shots.

DURATION & FORMAT
[DURATION] seconds. Exactly 7 shots, separated by clean hard cuts. Each shot is one continuous camera setup.

GLOBAL SETTINGS
- The hero: [SUBJECT]. Relaxed and introspective, completely still and unbothered. STRICT: he NEVER looks at the camera or into the lens in any shot — his gaze rests on his reflection, off-frame, or down at his own hand; lids low, expression neutral and lost in thought. No smiling, no posing to lens, no alarm.
- The object: [MOTIF]. It moves in a continuous slow flow with organic weight and elasticity and a specular sheen on every surface. Editorial and sculptural, never horror, never threatening; it never touches his face or neck.
- His only movement: [MOVE] — a single slow continuous move, unhurried and weightless. Nothing else about him moves at any point.
- The transformation: [TURN] — one seamless continuous morph in a single unbroken shot: no cut, no dissolve, no flash, no particles, no sparkles, no magic effect. Photoreal at every stage.
- Environment (fixed, must not change between shots): [SET]. The same room and the same fittings in every shot, deep shadow beyond.
- Lighting & colour (fixed): the only light source in the entire film is [LIGHT] — a hard interior light, unmoving and unchanging in every shot. There is no window, no daylight and no sunbeam anywhere in this location. The light never travels, sweeps, drifts across his face, pulses or changes angle; illumination is completely static, only the object and his hand move through it. Steep falloff into near-black shadow, soft speculars, filmic highlight roll-off. Palette: [PALETTE].
- Camera & style: high-end fashion campaign — sculptural framing, slow deliberate camera movement (slow push-ins and slow drifts only), shallow depth of field, anamorphic-feel lenses, subtle film grain, photoreal skin and materials. Shot scale and angle change with every cut: WS → MS → macro CU → low level → high overhead → profile MCU → MCU on the hand. 240fps ultra slow motion ONLY in the shots marked below; all other shots run at natural real-time speed.

TIMELINE — divide [DURATION] evenly across the seven shots, in this order:
SHOT 1 — WS, real time. Wide sculptural establishing shot of the set with the hero and the object already in place, his reflection or silhouette held in the composition. Slow push-in begins. He looks away from the lens.
SHOT 2 — MS three-quarter from behind, 240fps ultra slow motion. Slow dolly in over his shoulder as the object moves across the wardrobe fabric, surfaces sliding and overlapping under the fixed light. He stands completely still, head turned away from camera.
SHOT 3 — macro CU, 240fps ultra slow motion. Extreme close detail where the object meets the wardrobe: individual surfaces flexing and overlapping, the fixed light picking out the sheen. Shallow focus; his jawline and lowered eyes soft in the background.
SHOT 4 — low angle at floor or furniture level, real time. Camera low, looking up past a foreground edge; his silhouette rimmed by the fixed light, the object moving slowly against the dark background.
SHOT 5 — high overhead, 240fps ultra slow motion. Looking straight down: the object reads as a graphic shape across his shoulders, the set's geometry cutting the composition. His hand begins to rise into the lower frame, palm opening upward. Sculptural, symmetrical.
SHOT 6 — profile MCU, real time. Tight side profile: his open palm is now raised and he lowers his eyes to it, lids heavy, expression neutral. The object flows down his forearm in one long continuous movement and begins to gather in his hand. The light sits flat and even on his temple and shoulder.
SHOT 7 — MCU on the hand, real time, slow push-in. The transformation completes in one unbroken morph on his open palm. His fingers stay soft and open, his eyes stay on it. The camera settles. End on this live image, bright and visible to the last frame.

AUDIO
Minimal, immersive, diegetic-forward: [SOUND]. Underneath it all, one low cinematic drone that swells gently and fades out at the end. No dialogue, no voiceover, no breathing sounds, no sighs, no gasps, no music track, no lyrics.

NEGATIVE
sunlight, sunbeam, sun glare, shaft of daylight, window, daylight, god rays, lens flare, moving or travelling light, light sweeping across the face, pulsing or flickering light, changing light direction, model looking at the camera, eye contact with lens, direct gaze, smiling, posing to camera, alarm, flinching, distressed or fearful expression, struggling, aggression, blood, gore, magic sparkles, particle effects, flash of light during the transformation, cut or dissolve during the transformation, the result appearing abruptly, the object vanishing, two objects at once, cartoon or stylised morph, changing or inconsistent set, different room, extra furniture appearing, breathing sounds, sighs, gasps, fade to black, fade out, blackout, dark ending, subtitles, text, logos, watermarks, deformed hands, extra fingers, deformed faces, character inconsistency between shots, wardrobe changes, rubbery or plastic CGI look.`,
  },
];

/**
 * Подставить заполненное в заготовку.
 *
 * Незаполненное НЕ вычищается молча: место остаётся видимым — `[МЕСТО]` в
 * тексте промпта. Тихо убрать его хуже, чем оставить: человек отправит промпт,
 * не заметив, что половина сцены не описана, и удивится результату. Исключение
 * — места, помеченные как блок целиком (`block`): их пустыми и задумывали, и
 * тогда из текста уходит вся строка, а не только скобка.
 */
function fill(template, values = {}) {
  if (!template) return "";
  let text = template.body;
  for (const slot of template.slots || []) {
    const value = String(values[slot.key] ?? "").trim();
    if (!value && slot.block) {
      // Строку с необязательным блоком убираем целиком, вместе с пустой
      // строкой за ней: иначе в промпте остаётся дыра из скобок.
      text = text.replace(new RegExp(`\\n*\\[${escapeRe(slot.key)}[^\\]]*\\]\\n*`, "g"), "\n\n");
      continue;
    }
    if (!value) continue;
    text = text.replace(new RegExp(`\\[${escapeRe(slot.key)}\\]`, "g"), value);
    // У необязательного блока текст-подсказка живёт внутри скобок — тогда
    // подставленное дописывается к ней, а не заменяет её.
    text = text.replace(new RegExp(`\\[${escapeRe(slot.key)}([^\\]]*)\\]`, "g"), (_, tail) => `${tail.replace(/^:\s*/, "").trim()} ${value}`.trim());
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Какие места остались незаполненными — чтобы сказать об этом до генерации. */
function emptySlots(template, values = {}) {
  if (!template) return [];
  return (template.slots || [])
    .filter((slot) => !slot.block && !String(values[slot.key] ?? "").trim())
    .map((slot) => slot.name);
}

function byId(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

module.exports = { TEMPLATES, fill, emptySlots, byId };

