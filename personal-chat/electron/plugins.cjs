// Build configuration: which modules this particular build of the app ships with.
//
// A plugins.json placed next to package.json (in development) or inside the
// packaged app's resources turns modules off, which is how a customised build —
// "только тексты", "только отчётность" — is produced without forking the code.
// The file is written by the Сборки section of «Личный код».
//
// No file, an unreadable file, or an unknown key means everything is on: a
// missing config must never leave someone with an app that has lost its
// sections.

const path = require("node:path");
const fs = require("node:fs");

const MODULE_IDS = [
  "projects",
  "skills",
  "excel",
  "word",
  "design",
  "media",
  "cloud",
  "direct",
  "github",
  "chatbots",
];

// The base every build shares: chat with a model picker, projects and
// instructions, skills, scheduled tasks, files from the computer, saving
// results, and design. These stay on whatever the file says; everything else is
// an optional plugin.
const ALWAYS_ON = ["projects", "skills", "design"];

function candidatePaths(app) {
  const paths = [path.join(__dirname, "..", "plugins.json")];
  if (app?.isPackaged) {
    paths.unshift(path.join(process.resourcesPath, "plugins.json"));
    paths.unshift(path.join(process.resourcesPath, "app", "plugins.json"));
  }
  return paths;
}

function load(app) {
  const enabled = {};
  for (const id of MODULE_IDS) enabled[id] = true;
  let productName = "Личный чат";
  let source = "";

  for (const file of candidatePaths(app)) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.productName === "string" && parsed.productName.trim()) {
        productName = parsed.productName.trim();
      }
      const modules = parsed.modules || {};
      for (const id of MODULE_IDS) {
        if (typeof modules[id] === "boolean") enabled[id] = modules[id];
      }
      source = file;
    } catch (e) {
      console.error(`plugins.json (${file}) не разобран, включаю все модули:`, e.message);
    }
    break;
  }

  for (const id of ALWAYS_ON) enabled[id] = true;
  return { productName, modules: enabled, source };
}

module.exports = { MODULE_IDS, load };
