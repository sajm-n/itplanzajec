// Wysyła powiadomienia push o zadaniach, gdy aplikacja jest zamknięta. Uruchamia go GitHub Actions co 5 minut.
// Logikę terminów bierze wprost z index.html (blok CORE), więc zawsze zgadza się z tym, co pokazuje aplikacja.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendPush } from "./webpush.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const readJson = (f, def) => { try { return JSON.parse(read(f)); } catch { return def; } };
const writeJson = (f, o) => fs.writeFileSync(path.join(ROOT, f), JSON.stringify(o, null, 2) + "\n");

const DRY = process.env.DRY_RUN === "true";
const TEST = process.env.TEST === "true";
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();

/* ----- Rdzeń aplikacji (walidacja planu, terminy przypomnień) ----- */
const html = read("index.html");
const a = html.indexOf("//#CORE-BEGIN"), b = html.indexOf("//#CORE-END");
if (a < 0 || b < a) { console.error("Nie znaleziono bloku CORE w index.html."); process.exit(1); }
const store = { getItem: () => null, setItem() {}, removeItem() {} };
const core = new Function("localStorage", html.slice(a, b) + "\nreturn {validatePlan,taskAlert,fromDK,fmtT};")(store);

const vapidPublic = process.env.VAPID_PUBLIC_KEY || (/const VAPID_PUBLIC="([^"]+)"/.exec(html) || [])[1];
const vapidPrivate = process.env.VAPID_PRIVATE_KEY || "";
const subject = process.env.VAPID_SUBJECT || "https://sajm-n.github.io/itplanzajec/";
if (!vapidPublic) { console.error("Brak klucza publicznego VAPID w index.html."); process.exit(1); }

/* ----- Treść powiadomień (zgodna z alertTexts w index.html) ----- */
const dl = (d) => d.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const same = (x, y) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();

function buildTexts(plan, t) {
  const label = t.kind === "online"
    ? ((plan.subjects.find((s) => s.id === t.sid) || {}).name || "Online")
    : ((plan.classes.find((c) => c.id === t.cid) || {}).name || "Zajęcia");
  const d = core.fromDK(t.due), td = day0(now), tm = new Date(td.getFullYear(), td.getMonth(), td.getDate() + 1);
  const w = same(d, td) ? "dziś" : same(d, tm) ? "jutro" : dl(d);
  if (t.kind === "online") {
    return {
      title: "!!! Niewykonane zadanie online: " + t.text + " !!!",
      body: label + " · termin: " + w + " o " + core.fmtT(t.time || "23:59"),
    };
  }
  return {
    title: "!!! Niewykonane zadanie " + (w === "dziś" ? "na dziś" : w === "jutro" ? "na jutro" : "na " + w) + ": " + t.text + " !!!",
    body: label + (t.time ? " · zajęcia o " + core.fmtT(t.time) : ""),
  };
}

/* ----- Dane ----- */
const v = core.validatePlan(readJson("plan.json", null));
if (!v.ok) { console.error("plan.json: " + v.error); process.exit(1); }
const plan = v.plan;
const validSub = (s) => s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
const subsRaw = readJson("push-subscriptions.json", []);
let subs = Array.isArray(subsRaw) ? subsRaw.filter(validSub) : [];
const state = readJson("push-state.json", { sent: {} });
if (!state.sent || typeof state.sent !== "object") state.sent = {};
const stateBefore = JSON.stringify(state), subsBefore = JSON.stringify(subs);

const live = new Set(plan.tasks.map((t) => t.id));
for (const k of Object.keys(state.sent)) if (!live.has(k)) delete state.sent[k];

const jobs = TEST
  ? [{ id: "test", payload: { title: "eStudia", body: "To jest testowe powiadomienie push — działa przy zamkniętej aplikacji.", tag: "test", url: "./" } }]
  : plan.tasks
      .filter((t) => core.taskAlert(t, now) === "soon" && !state.sent[t.id])
      .map((t) => ({ id: t.id, payload: Object.assign(buildTexts(plan, t), { tag: t.id, url: "./" }) }));

console.log(now.toString() + " · zadań do powiadomienia: " + jobs.length + " · urządzeń: " + subs.length);
if (!jobs.length) finish(0);
if (!subs.length) { console.log("Brak zapisanych urządzeń — nic nie wysyłam (zadania zostaną wysłane, gdy urządzenie się zapisze)."); finish(0); }
if (DRY) { for (const j of jobs) console.log("[DRY_RUN]", JSON.stringify(j.payload)); finish(0); }
if (!vapidPrivate) {
  console.log("::warning::Brak sekretu VAPID_PRIVATE_KEY — dodaj go w Settings → Secrets and variables → Actions. Powiadomienia nie zostały wysłane.");
  finish(0);
}

let failed = false;
const gone = new Set();
for (const j of jobs) {
  let okCount = 0;
  for (const s of subs) {
    if (gone.has(s.endpoint)) continue;
    try {
      const r = await sendPush(s, j.payload, { publicKey: vapidPublic, privateKey: vapidPrivate, subject });
      if (r.ok) okCount++;
      else if (r.gone) gone.add(s.endpoint);
      else { failed = true; console.log("::warning::Push nie przyjęty (" + r.status + ") " + new URL(s.endpoint).host + " " + r.text); }
    } catch (e) { failed = true; console.log("::warning::Błąd wysyłki: " + e.message); }
  }
  if (j.id !== "test" && okCount > 0) state.sent[j.id] = Date.now();
  console.log("Zadanie " + j.id + ": dostarczono na " + okCount + " urządzeń.");
}
if (gone.size) { subs = subs.filter((s) => !gone.has(s.endpoint)); console.log("Usunięto wygasłe subskrypcje: " + gone.size); }
finish(failed ? 1 : 0);

function finish(code) {
  if (JSON.stringify(state) !== stateBefore) writeJson("push-state.json", state);
  if (JSON.stringify(subs) !== subsBefore) writeJson("push-subscriptions.json", subs);
  process.exit(code);
}
