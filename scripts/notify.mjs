// Wysyła powiadomienia push o zadaniach, gdy aplikacja jest zamknięta. Uruchamia go GitHub Actions co 5 minut.
// Logikę terminów bierze wprost z index.html (blok CORE), więc zawsze zgadza się z tym, co pokazuje aplikacja.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendPush, resolveVapidPrivate } from "./webpush.mjs";

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
const core = new Function("localStorage", html.slice(a, b) + "\nreturn {validatePlan,taskAlert,taskTrigger,fromDK,fmtT};")(store);

const vapidPublic = process.env.VAPID_PUBLIC_KEY || (/const VAPID_PUBLIC="([^"]+)"/.exec(html) || [])[1];
const vapidPrivateRaw = process.env.VAPID_PRIVATE_KEY || "";
const subject = process.env.VAPID_SUBJECT || "https://sajm-n.github.io/itplanzajec/";
if (!vapidPublic) { console.error("Brak klucza publicznego VAPID w index.html."); process.exit(1); }

/* Tryb --check (uruchamiany na starcie pętli): sprawdza, czy sekret pasuje do klucza publicznego. Zły sekret = czerwony przebieg
   w Actions (i e-mail od GitHuba), a nie cicha awaria wysyłki przy każdym powiadomieniu. */
if (process.argv.includes("--check")) {
  if (!vapidPrivateRaw) { console.log("::error::Brak sekretu VAPID_PRIVATE_KEY (Settings → Secrets and variables → Actions)."); process.exit(1); }
  try { resolveVapidPrivate(vapidPrivateRaw, vapidPublic); console.log("Klucz VAPID poprawny."); process.exit(0); }
  catch (e) { console.log("::error::" + e.message); process.exit(1); }
}

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
if (!state.fail || typeof state.fail !== "object") state.fail = {};

/* Dostarczenie śledzimy osobno dla każdego urządzenia: zadanie dotarło do telefonu albo nie, niezależnie od tego, co z innymi.
   Dawny format (liczba) oznaczał „wysłano”, więc dla zgodności traktujemy go jako dostarczone wszędzie. */
const dev = (s) => crypto.createHash("sha256").update(s.endpoint).digest("hex").slice(0, 12);
/* Termin powiadomienia zadania (własny albo domyślny z ustawień). Zadanie, któremu przesunięto go na później niż ostatnie wysłanie,
   dostaje powiadomienie ponownie; przesunięcie na wcześniej nie wysyła drugi raz. */
const startOf = (t) => core.taskTrigger(t, plan.notif).start.getTime();
const delivered = (t, s) => {
  const v = state.sent[t.id];
  if (typeof v === "number") return true;
  const ts = v && v[dev(s)];
  return !!ts && ts >= startOf(t);
};
const markSent = (id, s) => { if (typeof state.sent[id] === "number" || !state.sent[id]) state.sent[id] = {}; state.sent[id][dev(s)] = Date.now(); };

const jobs = TEST
  ? [{ id: "test", payload: { title: "eStudia", body: "To jest testowe powiadomienie push — działa przy zamkniętej aplikacji.", tag: "test", url: "./" } }]
  : plan.tasks
      .filter((t) => core.taskAlert(t, now, plan.notif) === "soon" && subs.some((s) => !delivered(t, s)))
      .map((t) => ({ id: t.id, task: t, payload: Object.assign(buildTexts(plan, t), { tag: t.id, url: "./" }) }));

console.log(now.toString() + " · zadań do powiadomienia: " + jobs.length + " · urządzeń: " + subs.length);
if (!jobs.length) finish(0);
if (!subs.length) { console.log("Brak zapisanych urządzeń — nic nie wysyłam (zadania zostaną wysłane, gdy urządzenie się zapisze)."); finish(0); }
if (DRY) { for (const j of jobs) console.log("[DRY_RUN]", JSON.stringify(j.payload)); finish(0); }
if (!vapidPrivateRaw) {
  console.log("::error::Brak sekretu VAPID_PRIVATE_KEY — dodaj go w Settings → Secrets and variables → Actions. Powiadomienia nie zostały wysłane.");
  finish(1);
}
let vapidPrivate;
try { vapidPrivate = resolveVapidPrivate(vapidPrivateRaw, vapidPublic); }
catch (e) { console.log("::error::" + e.message + " Powiadomienia nie zostały wysłane."); finish(1); }

let failed = false;
const gone = new Set();
const MAX_FAILS = 6; // tyle kolejnych odrzuceń z rzędu i subskrypcja uznawana jest za martwą
for (const j of jobs) {
  let okCount = 0;
  for (const s of subs) {
    if (gone.has(s.endpoint)) continue;
    if (j.id !== "test" && delivered(j.task, s)) continue;
    const d = dev(s), host = new URL(s.endpoint).host;
    try {
      const r = await sendPush(s, j.payload, { publicKey: vapidPublic, privateKey: vapidPrivate, subject });
      if (r.ok) { okCount++; delete state.fail[d]; if (j.id !== "test") markSent(j.id, s); }
      else if (r.gone) { gone.add(s.endpoint); console.log("Urządzenie " + d + " (" + host + "): subskrypcja wygasła (" + r.status + ")."); }
      else {
        failed = true;
        state.fail[d] = (state.fail[d] || 0) + 1;
        console.log("::warning::Push nie przyjęty (" + r.status + ") " + host + " " + d + " " + r.text);
        if (state.fail[d] >= MAX_FAILS) gone.add(s.endpoint);
      }
    } catch (e) { failed = true; console.log("::warning::Błąd wysyłki: " + e.message); }
  }
  console.log("Zadanie " + j.id + ": dostarczono teraz na " + okCount + " urządzeń.");
}
if (gone.size) { for (const s of subs) if (gone.has(s.endpoint)) delete state.fail[dev(s)]; subs = subs.filter((s) => !gone.has(s.endpoint)); console.log("Usunięto martwe subskrypcje: " + gone.size); }
finish(failed ? 1 : 0);

function finish(code) {
  if (JSON.stringify(state) !== stateBefore) writeJson("push-state.json", state);
  if (JSON.stringify(subs) !== subsBefore) writeJson("push-subscriptions.json", subs);
  process.exit(code);
}
