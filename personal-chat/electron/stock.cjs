// Бесплатный сток для монтажа: видео, фото, музыка и звуки.
//
// Источники и что им нужно:
//   Pexels      — видео и фото, бесплатный ключ (pexels.com/api)
//   Pixabay     — видео и фото, бесплатный ключ (pixabay.com/api/docs)
//   Openverse   — музыка и звуки под свободными лицензиями, БЕЗ ключа
//   Freesound   — звуковые эффекты, бесплатный ключ (freesound.org/apiv2/apply)
//   Jamendo     — музыка, бесплатный client_id (devportal.jamendo.com)
//
// Без единого ключа работает Openverse — поэтому музыка и звуки ищутся сразу.
// Лицензии у материала разные: Pexels и Pixabay разрешают всё без подписи, а
// Creative Commons BY просит указать автора. Поэтому рядом со скачанным
// файлом записывается, откуда он и чей, — подпись к ролику берётся оттуда.

const fs = require("node:fs/promises");
const path = require("node:path");

const PROVIDERS = [
  { id: "pexels", name: "Pexels", kinds: ["video", "image"], key: "pexels", keyUrl: "https://www.pexels.com/api/" },
  { id: "pixabay", name: "Pixabay", kinds: ["video", "image"], key: "pixabay", keyUrl: "https://pixabay.com/api/docs/" },
  { id: "openverse", name: "Openverse (без ключа)", kinds: ["music", "sfx"], key: "", keyUrl: "https://openverse.org" },
  { id: "freesound", name: "Freesound", kinds: ["sfx", "music"], key: "freesound", keyUrl: "https://freesound.org/apiv2/apply" },
  { id: "jamendo", name: "Jamendo", kinds: ["music"], key: "jamendo", keyUrl: "https://devportal.jamendo.com/" },
];

async function getJson(url, init, fetchImpl, what) {
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 401 || res.status === 403 ? " Ключ не принят — проверьте его." : res.status === 429 ? " Слишком много запросов — подождите минуту." : "";
    throw new Error(`${what}: ответ ${res.status}.${hint} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** «by-sa» → «CC BY-SA 4.0»: по этой строке потом решается, нужна ли подпись автора. */
function openverseLicense(r) {
  const id = String(r.license || "").toLowerCase();
  if (id === "cc0") return "CC0";
  if (id === "pdm") return "Public Domain";
  return `CC ${id.toUpperCase()} ${r.license_version || ""}`.trim();
}

/** Видеофайл ближе всего к нужной высоте, но не больше 4K. */
function bestFile(files, target = 1920) {
  const ok = files.filter((f) => f.link || f.url).map((f) => ({ ...f, size: Math.max(f.width || 0, f.height || 0) }));
  ok.sort((a, b) => Math.abs(a.size - target) - Math.abs(b.size - target));
  return ok[0];
}

/**
 * Поиск. kind: video | image | music | sfx; orientation: portrait | landscape | square.
 * Ответ одинаковый для всех источников — окну не важно, откуда что.
 */
async function search({ provider, kind, query, orientation = "", keys = {}, page = 1, fetchImpl = fetch }) {
  const q = encodeURIComponent(String(query || "").trim());
  if (!q) return [];
  const need = PROVIDERS.find((p) => p.id === provider);
  if (!need) throw new Error(`Нет такого источника: ${provider}`);
  if (need.key && !keys[need.key]) throw new Error(`Для ${need.name} нужен бесплатный ключ — его берут на ${need.keyUrl}`);

  if (provider === "pexels") {
    const key = keys.pexels;
    if (kind === "image") {
      const data = await getJson(`https://api.pexels.com/v1/search?query=${q}&per_page=24&page=${page}${orientation ? `&orientation=${orientation}` : ""}`, { headers: { Authorization: key } }, fetchImpl, "Pexels");
      return (data.photos || []).map((p) => ({
        provider, kind: "image", id: String(p.id), title: p.alt || `Фото ${p.id}`, thumb: p.src?.medium || p.src?.small || "",
        url: p.src?.large2x || p.src?.original, author: p.photographer || "", license: "Pexels License", page: p.url || "", duration: 0, ext: ".jpg",
      }));
    }
    const data = await getJson(`https://api.pexels.com/videos/search?query=${q}&per_page=24&page=${page}${orientation ? `&orientation=${orientation}` : ""}`, { headers: { Authorization: key } }, fetchImpl, "Pexels");
    return (data.videos || []).map((v) => {
      const f = bestFile(v.video_files || []);
      return {
        provider, kind: "video", id: String(v.id), title: `Видео ${v.id}`, thumb: v.image || "", url: f ? f.link : "",
        width: f?.width || v.width, height: f?.height || v.height, author: v.user?.name || "", license: "Pexels License", page: v.url || "", duration: v.duration || 0, ext: ".mp4",
      };
    }).filter((x) => x.url);
  }

  if (provider === "pixabay") {
    const key = encodeURIComponent(keys.pixabay);
    const orient = orientation === "portrait" ? "vertical" : orientation === "landscape" ? "horizontal" : "all";
    if (kind === "image") {
      const data = await getJson(`https://pixabay.com/api/?key=${key}&q=${q}&image_type=photo&per_page=24&page=${page}&orientation=${orient}&safesearch=true`, {}, fetchImpl, "Pixabay");
      return (data.hits || []).map((h) => ({
        provider, kind: "image", id: String(h.id), title: h.tags || `Фото ${h.id}`, thumb: h.webformatURL || h.previewURL, url: h.largeImageURL,
        author: h.user || "", license: "Pixabay Content License", page: h.pageURL || "", duration: 0, ext: ".jpg",
      }));
    }
    const data = await getJson(`https://pixabay.com/api/videos/?key=${key}&q=${q}&per_page=24&page=${page}&safesearch=true`, {}, fetchImpl, "Pixabay");
    return (data.hits || []).map((h) => {
      const vids = h.videos || {};
      const f = bestFile(Object.values(vids).map((x) => ({ ...x, link: x.url })));
      return {
        provider, kind: "video", id: String(h.id), title: h.tags || `Видео ${h.id}`, thumb: vids.tiny?.thumbnail || vids.small?.thumbnail || "",
        url: f ? f.url : "", width: f?.width, height: f?.height, author: h.user || "", license: "Pixabay Content License", page: h.pageURL || "", duration: h.duration || 0, ext: ".mp4",
      };
    }).filter((x) => x.url);
  }

  if (provider === "openverse") {
    const category = kind === "sfx" ? "sound_effect" : "music";
    const data = await getJson(`https://api.openverse.org/v1/audio/?q=${q}&page_size=20&page=${page}&category=${category}`, { headers: { "User-Agent": "LichnyChat-Montage/1.0" } }, fetchImpl, "Openverse");
    return (data.results || []).map((r) => ({
      provider, kind, id: String(r.id), title: r.title || "Без названия", thumb: r.thumbnail || "", url: r.url,
      author: r.creator || "", license: openverseLicense(r), licenseUrl: r.license_url || "",
      page: r.foreign_landing_url || "", duration: r.duration ? r.duration / 1000 : 0, ext: path.extname(new URL(r.url).pathname) || ".mp3",
    })).filter((x) => x.url);
  }

  if (provider === "freesound") {
    const filter = kind === "music" ? "&filter=duration:[30 TO *]" : "&filter=duration:[0 TO 15]";
    const data = await getJson(`https://freesound.org/apiv2/search/text/?query=${q}&page_size=20&page=${page}&fields=id,name,duration,previews,license,username,url${filter}&token=${encodeURIComponent(keys.freesound)}`, {}, fetchImpl, "Freesound");
    return (data.results || []).map((r) => ({
      provider, kind, id: String(r.id), title: r.name, thumb: "", url: r.previews?.["preview-hq-mp3"] || r.previews?.["preview-lq-mp3"],
      author: r.username || "", license: String(r.license || "").replace(/^https?:\/\/creativecommons\.org\/(licenses|publicdomain)\//, "CC ").replace(/\/$/, ""), licenseUrl: r.license || "",
      page: r.url || "", duration: r.duration || 0, ext: ".mp3",
    })).filter((x) => x.url);
  }

  if (provider === "jamendo") {
    const data = await getJson(`https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(keys.jamendo)}&format=json&limit=20&offset=${(page - 1) * 20}&search=${q}&audioformat=mp32&include=licenses`, {}, fetchImpl, "Jamendo");
    return (data.results || []).map((r) => ({
      provider, kind: "music", id: String(r.id), title: r.name, thumb: r.image || "", url: r.audiodownload_allowed === false ? r.audio : r.audiodownload || r.audio,
      author: r.artist_name || "", license: "Creative Commons", licenseUrl: r.license_ccurl || "", page: r.shareurl || "", duration: r.duration || 0, ext: ".mp3",
    })).filter((x) => x.url);
  }
  return [];
}

function safeName(s) {
  return String(s || "").replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "файл";
}

/**
 * Скачать в папку стока проекта. Уже скачанное не качается повторно.
 * Рядом — запись об авторе и лицензии: у CC BY подпись автора обязательна.
 */
async function download(item, dir, { fetchImpl = fetch, onProgress } = {}) {
  await fs.mkdir(dir, { recursive: true });
  const kindDir = { video: "видео", image: "фото", music: "музыка", sfx: "звуки" }[item.kind] || "разное";
  const folder = path.join(dir, kindDir);
  await fs.mkdir(folder, { recursive: true });
  const dest = path.join(folder, `${item.provider}-${safeName(item.id)}-${safeName(item.title)}${item.ext || ""}`);
  try {
    await fs.access(dest);
    return dest;
  } catch {
    // ещё не скачан
  }
  const res = await fetchImpl(item.url);
  if (!res.ok) throw new Error(`Файл не скачался: ответ ${res.status}.`);
  const total = Number(res.headers?.get?.("content-length")) || 0;
  let buf;
  if (res.body && typeof res.body.getReader === "function" && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      got += value.length;
      onProgress(total ? got / total : 0);
    }
    buf = Buffer.concat(chunks);
  } else {
    buf = Buffer.from(await res.arrayBuffer());
  }
  // Сначала во временный файл: оборванная загрузка не должна выглядеть готовой.
  await fs.writeFile(dest + ".part", buf);
  await fs.rename(dest + ".part", dest);
  const creditsFile = path.join(dir, "авторы.json");
  let credits = [];
  try {
    credits = JSON.parse(await fs.readFile(creditsFile, "utf-8"));
  } catch {
    credits = [];
  }
  credits.push({ file: path.relative(dir, dest), provider: item.provider, title: item.title, author: item.author, license: item.license, licenseUrl: item.licenseUrl || "", page: item.page, at: new Date().toISOString() });
  await fs.writeFile(creditsFile, JSON.stringify(credits, null, 2), "utf-8");
  return dest;
}

/** Подпись для описания ролика: кто автор музыки и картинок, если лицензия просит. */
async function creditsFor(dir, files) {
  let credits = [];
  try {
    credits = JSON.parse(await fs.readFile(path.join(dir, "авторы.json"), "utf-8"));
  } catch {
    return "";
  }
  const used = new Set(files.map((f) => path.relative(dir, f)));
  const lines = credits
    .filter((c) => used.has(c.file) && /CC|Creative/i.test(c.license) && !/CC0|publicdomain/i.test(c.license))
    .map((c) => `«${c.title}» — ${c.author || "автор не указан"} (${c.license})${c.page ? `, ${c.page}` : ""}`);
  return lines.length ? `Использовано:\n${[...new Set(lines)].join("\n")}` : "";
}

module.exports = { PROVIDERS, search, download, creditsFor, bestFile };
