// Simulation de bout en bout d'une veille quotidienne sur 10 jours, sans aucun service payant ni attente réelle.
//
// Horloge simulée (Date), vraie API, vrai worker, vraie base (PGlite, ou un vrai Postgres avec SCENARIO_DATABASE_URL),
// et trois faux services : Le Bon Coin (via Apify) avec un marché qui vit au fil du temps (publications, remontées,
// annonces supprimées puis republiées), l'IA (OpenAI) et Resend (e-mails).
//
// Chaque relève est comparée à un modèle indépendant de ce qu'elle doit trouver : exactement les annonces jamais vues
// au-dessus du curseur, ni plus (remontées, republications) ni moins (rien de perdu, même après une panne, un
// redémarrage ou une pause) ; le curseur, l'heure du passage suivant (heure de Paris, changement d'heure compris), les
// pages lues (aucune page relue pour rien) et l'e-mail envoyé (un seul, au bon compte, avec les bonnes annonces).
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, mock } from "node:test";
import { asc, eq } from "drizzle-orm";
import { housingListings, housingSearches, mailOutbox, openDatabase } from "@workspace/db";
import { fatihRecord, leboncoinLabel } from "../../test/fatih";

const MIN = 60_000;
const HOUR = 60 * MIN;
const utc = (value: string) => Date.parse(value);

// --- Marché simulé ------------------------------------------------------------------------------------------------
// Les annonces paraissent entre la 25e et la 55e minute de chaque heure ; toutes les actions du scénario (relèves,
// visites, réglages) ont lieu entre la minute 0 et la minute 20. Ainsi « ce qui a paru avant la relève » est net.

type Ad = { n: number; title: string; postedAt: number; bumps: number[]; removedAt: number | null; repostOf: number | null };

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = utc("2026-10-14T00:00:00Z"); // 8 jours d'historique avant la création de la veille
const END = utc("2026-11-01T22:00:00Z");
const ads: Ad[] = [];
{
  const rand = random(20261022);
  const inHour = (hourStart: number) => hourStart + Math.floor((25 + rand() * 30) * MIN / 1000) * 1000;
  let n = 1;
  for (let hour = START; hour < END; hour += HOUR) {
    const paris = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(hour));
    const weekend = [0, 6].includes(new Date(hour).getUTCDay());
    const rate = paris >= 7 && paris <= 21 ? (weekend ? 1.5 : 3) : 0.3; // Lille : ≈ 48 annonces par jour de semaine
    const count = Math.floor(rate) + (rand() < rate % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const postedAt = inHour(hour);
      const ad: Ad = { n: n++, title: `Appartement T2 n° ${n - 1}`, postedAt, bumps: [], removedAt: null, repostOf: null };
      if (rand() < 0.15) ad.bumps.push(inHour(postedAt - (postedAt % HOUR) + (1 + Math.floor(rand() * 72)) * HOUR)); // remontée
      ads.push(ad);
    }
  }
  // Annonces supprimées puis republiées par leur auteur (nouvelle adresse, même contenu).
  for (const original of ads.filter(() => rand() < 0.04)) {
    const at = inHour(original.postedAt - (original.postedAt % HOUR) + (12 + Math.floor(rand() * 84)) * HOUR);
    if (at >= END) continue;
    original.removedAt = at;
    ads.push({ n: n++, title: original.title, postedAt: at, bumps: [], removedAt: null, repostOf: original.n });
  }
}
const urlOf = (ad: Ad) => `https://www.leboncoin.fr/ad/locations/${ad.n}`;
const visible = (ad: Ad, now: number) => ad.postedAt <= now && (ad.removedAt == null || ad.removedAt > now);
const updatedAt = (ad: Ad, now: number) => Math.max(ad.postedAt, ...ad.bumps.filter(at => at <= now));
const market = (now: number) => ads.filter(ad => visible(ad, now)).sort((a, b) => updatedAt(b, now) - updatedAt(a, now) || b.n - a.n);
const byN = new Map(ads.map(ad => [ad.n, ad]));

// --- Faux services ------------------------------------------------------------------------------------------------

type Read = { page: number; limit: number; dates: number[] };
let reads: Read[] = [];
let failApify = false;
let llmDown = false;
const analyzed = new Map<string, number>(); // titre → nombre d'analyses
type SentMail = { status: number; to: string[]; subject: string; html: string; text: string; key: string | undefined };
let mails: SentMail[] = [];
let resendStatuses: number[] = [];
const runs = new Map<string, unknown[]>();
let fake: Server;

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const json = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v2/acts/fatihtahta~leboncoin-fr-scraper/runs")) {
        const input = JSON.parse(body) as { startUrls: string[]; limit: number };
        const page = Number(new URL(input.startUrls[0]).searchParams.get("page") ?? 1);
        const now = Date.now();
        const items = market(now).slice((page - 1) * 35, (page - 1) * 35 + input.limit);
        reads.push({ page, limit: input.limit, dates: items.map(ad => updatedAt(ad, now)) });
        const id = `run-${runs.size + 1}`;
        runs.set(id, items.map(ad => fatihRecord({
          url: urlOf(ad), title: ad.title, description: "Appartement lumineux, proche métro.", price: 650, area: 40, rooms: 2,
          postedAt: leboncoinLabel(ad.postedAt), updatedAt: leboncoinLabel(updatedAt(ad, now)),
        })));
        return json({ data: { id } });
      }
      const run = url.match(/^\/v2\/actor-runs\/(run-\d+)/);
      if (run) return json({ data: { status: failApify ? "FAILED" : "SUCCEEDED", defaultDatasetId: run[1] } });
      const dataset = url.match(/^\/v2\/datasets\/(run-\d+)\/items/);
      if (dataset) return json(runs.get(dataset[1]) ?? []);
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        let content: unknown;
        if (request.messages[0].content.includes("Interprète une demande")) {
          content = { location: "Lille", intent: "rent", maxPrice: 900, radius: 5, keywords: "", uncertainChecks: [], places: [] };
        } else if (llmDown) {
          return json({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }, 401);
        } else {
          const { listings } = JSON.parse(request.messages[1].content) as { listings: { id: number; title: string; wantGeneral: boolean }[] };
          for (const item of listings) analyzed.set(item.title, (analyzed.get(item.title) ?? 0) + 1);
          content = { items: listings.map(item => ({ id: item.id, checks: [], ...(item.wantGeneral ? { summary: "Logement lumineux.", summaryEvidence: ["Appartement lumineux"], features: [], offer: "entire", offerEvidence: "" } : {}) })) };
        }
        return json({ id: "x", object: "chat.completion", created: 0, model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      if (req.method === "POST" && url === "/emails") {
        const mail = JSON.parse(body) as { to: string[]; subject: string; html: string; text: string };
        const status = resendStatuses.shift() ?? 200;
        mails.push({ status, ...mail, key: req.headers["idempotency-key"] as string | undefined });
        return json(status === 200 ? { id: `mail-${mails.length}` } : { name: "internal_server_error", message: "Panne simulée" }, status);
      }
      json({}, 404);
    });
  });
  await new Promise<void>(resolve => fake.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    APIFY_BASE_URL: origin, APIFY_TOKEN: "test", OPENAI_BASE_URL: `${origin}/v1`, OPENAI_API_KEY: "test",
    RESEND_BASE_URL: origin, RESEND_API_KEY: "re_test", PUBLIC_URL: "https://vitemonlogement.fr",
    APP_PASSWORD: "Arblade", SESSION_SECRET: "secret-de-test",
  });
});
after(async () => {
  mock.timers.reset();
  fake.close();
  await api?.close();
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
  delete process.env.RESEND_API_KEY;
});

// --- Pilotage : horloge, API, worker ------------------------------------------------------------------------------

let api: Server | undefined;
let base = "";
let cookie = "";
const call = async (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) } });

/** Fait tourner le worker (horloge avançant de 6 s par tour) jusqu'à ce qu'il n'y ait plus rien à faire. */
async function idle() {
  const { createWorker } = await import("../../lib/worker");
  const { db } = await import("../../lib/database");
  const worker = createWorker({ owner: "simulation" });
  for (let i = 0; i < 150; i++) {
    await worker.tick();
    const searches = await db().select().from(housingSearches);
    const pending = await db().select().from(mailOutbox).where(eq(mailOutbox.status, "pending"));
    if (searches.every(row => row.status !== "running" && !row.task) && !pending.length) return;
    mock.timers.setTime(Date.now() + 6_000);
  }
  throw new Error("Le worker n'a pas terminé");
}
/**
 * Relèves étalées (0 à 5 min après l'heure choisie) : fait tourner le worker, 6 s par tour, jusqu'à ce que la veille
 * parte (tâche posée, passage reprogrammé ou mise en pause), puis jusqu'à ce qu'il n'y ait plus rien à faire.
 */
async function untilWatchStarts() {
  const { createWorker } = await import("../../lib/worker");
  const worker = createWorker({ owner: "simulation" });
  const start = await row();
  for (let i = 0; i < 60; i++) {
    await worker.tick();
    const now = await row();
    if (now.task || now.watched !== start.watched || now.nextWatchAt !== start.nextWatchAt) return idle();
    mock.timers.setTime(Date.now() + 6_000);
  }
  throw new Error("La relève n'est pas partie dans les 6 minutes");
}
const setClock = (value: string | number) => mock.timers.setTime(typeof value === "number" ? value : utc(value));

let searchId = 0;
const row = async () => {
  const { db } = await import("../../lib/database");
  return (await db().select().from(housingSearches).where(eq(housingSearches.id, searchId)))[0];
};
const stored = async () => {
  const { db } = await import("../../lib/database");
  return db().select().from(housingListings).where(eq(housingListings.searchId, searchId)).orderBy(asc(housingListings.id));
};

/** Modèle : ce qu'une relève doit trouver, d'après le marché et ce que la veille a déjà enregistré (ses adresses). */
function expectedNew(now: number, cursor: number, knownUrls: Set<string>) {
  return market(now).filter(ad => {
    if (updatedAt(ad, now) <= cursor || knownUrls.has(urlOf(ad))) return false;
    // Republication d'une annonce déjà connue (et retirée) : pas nouvelle.
    const original = ad.repostOf == null ? null : byN.get(ad.repostOf)!;
    return !(original && knownUrls.has(urlOf(original)) && !visible(original, now));
  });
}

const report: string[] = [];
const totals = { read: 0, fresh: 0, rereads: 0 };
const newEver = new Map<string, string>(); // titre → relève qui l'a montré comme nouveau

type PassCheck = {
  /** Heure du passage suivant attendue (UTC), écrite en dur : vérifie aussi l'heure de Paris et le changement d'heure. */
  next: string;
  /** Pas de lecture attendue (panne d'Apify) : relève en échec, rien de nouveau, pas d'e-mail. */
  apifyDown?: boolean;
  /** E-mail attendu (false : désinscrit). */
  mail?: boolean;
  label: string;
};

/** Une relève à l'heure `slot` (UTC), vérifiée de bout en bout contre le modèle. */
async function pass(slot: string, check: PassCheck) {
  const { getSearch } = await import("./store");
  const before = await row();
  const knownUrls = new Set((await stored()).map(listing => listing.url));
  const cursor = before.cursorAt!;
  setClock(slot);
  const now = Date.now();
  const expected = check.apifyDown ? [] : expectedNew(now, cursor, knownUrls);
  reads = [];
  const mailsBefore = mails.length;
  failApify = Boolean(check.apifyDown);
  await untilWatchStarts();
  failApify = false;
  const after = await row();
  const listings = (await getSearch(searchId))!.listings;
  const label = `${check.label} (${slot})`;

  assert.equal(after.nextWatchAt, utc(check.next), `${label} : passage suivant`);
  if (check.apifyDown) {
    assert.equal(after.lastWatchStatus, "failed", label);
    assert.equal(after.cursorAt, cursor, `${label} : le curseur ne bouge pas, rien ne sera perdu`);
    assert.equal(mails.length, mailsBefore, `${label} : pas d'e-mail`);
    report.push(`${label} : Apify en panne, relève en échec`);
    return;
  }
  assert.equal(after.lastWatchStatus, "ok", label);
  // Relèves étalées (WATCH_SPREAD_SECONDS, 5 min par défaut) : départ dans les 5 minutes suivant l'heure choisie.
  assert.ok(after.lastWatchAt! >= now && after.lastWatchAt! - now < 5 * MIN, `${label} : heure de la relève`);

  // 1. Exactement les nouvelles annonces du modèle, ni plus ni moins.
  const fresh = listings.filter(listing => listing.firstSeenAt === after.lastWatchAt).map(listing => listing.title).sort();
  assert.deepEqual(fresh, expected.map(ad => ad.title).sort(), `${label} : annonces nouvelles`);
  for (const title of fresh) {
    assert.ok(!newEver.has(title), `${label} : « ${title} » déjà montrée comme nouvelle (${newEver.get(title)})`);
    newEver.set(title, label);
  }
  // 2. Curseur : la mise à jour la plus récente du marché ; il ne recule jamais.
  const top = market(now)[0];
  assert.equal(after.cursorAt, Math.floor(updatedAt(top, now) / 1000) * 1000, `${label} : curseur`);
  assert.ok(after.cursorAt! >= cursor, `${label} : le curseur ne recule pas`);
  // 3. Rien de perdu : toute annonce visible plus récente que le curseur précédent est enregistrée.
  const urls = new Set((await stored()).map(listing => listing.url));
  for (const ad of market(now).filter(ad => updatedAt(ad, now) > cursor)) assert.ok(urls.has(urlOf(ad)), `${label} : ${ad.title} manquante`);
  // 4. Pages lues : page 1 d'abord, puis la suite ; la page 1 relue au plus une fois ; aucune page entièrement déjà lue
  //    (sauf la toute première lecture, qui doit bien regarder s'il y a du nouveau).
  assert.equal(reads[0]?.page, 1, label);
  const pages = reads.map(read => read.page);
  assert.ok(pages.every((page, i) => i === 0 || page === pages[i - 1] || page === pages[i - 1] + 1), `${label} : pages ${pages}`);
  assert.ok(pages.filter(page => page === 1).length <= 2, `${label} : page 1 relue plus d'une fois`);
  for (const read of reads.slice(1)) assert.ok(read.dates.some(date => date > cursor), `${label} : page ${read.page} lue pour rien`);
  const itemsRead = reads.reduce((sum, read) => sum + read.dates.length, 0);
  const wasted = reads.reduce((sum, read) => sum + read.dates.filter(date => date <= cursor).length, 0);
  // 5. E-mail : un seul s'il y a du nouveau (sauf désinscription), au compte, avec ces annonces ; aucun sinon.
  const sent = mails.slice(mailsBefore).filter(mail => mail.status === 200);
  if (expected.length && check.mail !== false) {
    assert.equal(sent.length, 1, `${label} : un e-mail`);
    const [mail] = sent;
    assert.deepEqual(mail.to, ["veille@example.com"]);
    assert.equal(mail.subject, `${expected.length} ${expected.length > 1 ? "nouveaux logements" : "nouveau logement"} à Lille`, label);
    assert.equal(mail.key, `watch:${searchId}:${after.lastWatchAt}`, label);
    const shown = (mail.text.match(/^• (.+)$/gm) ?? []).map(line => line.slice(2));
    assert.equal(shown.length, Math.min(5, expected.length), `${label} : annonces dans l'e-mail`);
    for (const title of shown) assert.ok(fresh.includes(title), `${label} : « ${title} » dans l'e-mail n'est pas nouvelle`);
    if (expected.length > 5) assert.ok(mail.text.includes(`Et ${expected.length - 5} autre`), label);
    const parisHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now));
    assert.match(mail.text, new RegExp(`Relève de ${parisHour} h`), `${label} : heure de Paris dans l'e-mail`);
  } else {
    assert.equal(sent.length, 0, `${label} : pas d'e-mail`);
  }
  totals.read += itemsRead;
  totals.fresh += expected.length;
  totals.rereads += pages.filter(page => page === 1).length - 1;
  if (process.env.SCENARIO_DEBUG) report.push(`  débit ${after.watchRate} · par créneau ${after.watchRates}`);
  report.push(`${label} : ${expected.length} nouvelles · pages ${pages.join(",")} · limites ${reads.map(read => read.limit).join(",")} · ${itemsRead} lues dont ${wasted} déjà connues · e-mail ${sent.length ? "oui" : "non"}`);
}

const visit = async () => assert.equal((await call(`/housing/searches/${searchId}/visit`, { method: "POST" })).status, 204);
const unseen = async () => ((await (await call("/housing/watch")).json()) as { search: { unseenCount: number } | null }).search?.unseenCount;

// --- Le scénario --------------------------------------------------------------------------------------------------

test("veille quotidienne sur 10 jours : curseur, nouveautés exactes, pannes, redémarrage, changement d'heure, pause, e-mails", async () => {
  mock.timers.enable({ apis: ["Date"], now: utc("2026-10-22T10:00:00Z") }); // jeudi 22 octobre, midi à Paris
  const url = process.env.SCENARIO_DATABASE_URL;
  const { initDatabase } = await import("../../lib/database");
  if (url) { const handle = await openDatabase({ url }); await handle.migrate(); await initDatabase(handle); }
  else { const { useMemoryDatabase } = await import("../../test/helpers"); await useMemoryDatabase(); }
  const { default: app } = await import("../../app");
  api = app.listen(0);
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}/api`;
  const register = await fetch(`${base}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "Arblade", email: "veille@example.com", password: "motdepasse-1" }) });
  cookie = (register.headers.get("set-cookie") ?? "").split(";")[0];

  // Recherche ponctuelle, puis veille quotidienne à 8 h et 18 h : remontée des 4 derniers jours (3 pages au plus).
  const created = await call("/housing/searches", { method: "POST", body: JSON.stringify({ prompt: "Un T2 à Lille, 900 € max" }) });
  searchId = ((await created.json()) as { id: number }).id;
  await idle();
  assert.equal((await stored()).length, 15, "recherche ponctuelle : les 15 plus récentes");
  reads = [];
  assert.equal((await call(`/housing/searches/${searchId}/watch`, { method: "PUT", body: JSON.stringify({ times: ["08:00", "18:00"] }) })).status, 200);
  await idle();
  assert.deepEqual(reads.map(read => read.page), [1, 2, 3], "création : 4 jours dépassent 105 annonces, 3 pages");
  assert.equal(mails.length, 0, "aucun e-mail à la création");
  assert.equal(await unseen(), 0, "ce qui est remonté à la création n'est pas « nouveau »");
  assert.equal((await row()).nextWatchAt, utc("2026-10-22T16:00:00Z"), "premier passage : aujourd'hui 18 h à Paris");

  await pass("2026-10-22T16:00:00Z", { label: "jeu. 18 h", next: "2026-10-23T06:00:00Z" });
  setClock("2026-10-22T16:10:00Z"); await visit();
  await pass("2026-10-23T06:00:00Z", { label: "ven. 8 h", next: "2026-10-23T16:00:00Z" });
  await pass("2026-10-23T16:00:00Z", { label: "ven. 18 h", next: "2026-10-24T06:00:00Z" });
  setClock("2026-10-23T16:10:00Z"); await visit();
  await pass("2026-10-24T06:00:00Z", { label: "sam. 8 h", next: "2026-10-24T16:00:00Z" });
  await pass("2026-10-24T16:00:00Z", { label: "sam. 18 h", next: "2026-10-25T07:00:00Z" }); // dimanche : heure d'hiver
  setClock("2026-10-24T17:30:00Z"); await visit(); // dernière visite avant longtemps
  assert.equal(await unseen(), 0);

  // Changement d'heure (dimanche 25, 3 h → 2 h) : 8 h et 18 h à Paris restent 8 h et 18 h.
  const count = async () => (await stored()).filter(listing => listing.firstSeenAt! > utc("2026-10-24T17:30:00Z") && listing.hidden == null).length;
  await pass("2026-10-25T07:00:00Z", { label: "dim. 8 h (heure d'hiver)", next: "2026-10-25T17:00:00Z" });
  await pass("2026-10-25T17:00:00Z", { label: "dim. 18 h", next: "2026-10-26T07:00:00Z" });

  // Lundi : serveur arrêté de 8 h à 11 h (déploiement) ; un seul rattrapage à 11 h, puis 18 h.
  await pass("2026-10-26T10:00:00Z", { label: "lun. rattrapage 11 h", next: "2026-10-26T17:00:00Z" });
  setClock("2026-10-26T10:30:00Z");
  reads = [];
  await idle();
  assert.equal(reads.length, 0, "pas de second rattrapage");
  await pass("2026-10-26T17:00:00Z", { label: "lun. 18 h", next: "2026-10-27T07:00:00Z" });

  // Mardi 8 h : Apify en panne. La relève de 18 h trouve tout depuis lundi 18 h, rien n'est perdu.
  await pass("2026-10-27T07:00:00Z", { label: "mar. 8 h", next: "2026-10-27T17:00:00Z", apifyDown: true });
  await pass("2026-10-27T17:00:00Z", { label: "mar. 18 h (après la panne)", next: "2026-10-28T07:00:00Z" });

  // Mercredi 8 h : l'IA en panne. La relève est gardée, l'e-mail part (annonces pas encore résumées).
  llmDown = true;
  await pass("2026-10-28T07:00:00Z", { label: "mer. 8 h (IA en panne)", next: "2026-10-28T17:00:00Z" });
  llmDown = false;
  // Mercredi 18 h : Resend refuse une fois ; nouvel essai une minute plus tard, un seul e-mail.
  resendStatuses = [500];
  const attemptsBefore = mails.length;
  await pass("2026-10-28T17:00:00Z", { label: "mer. 18 h (Resend en panne une fois)", next: "2026-10-29T07:00:00Z" });
  const attempts = mails.slice(attemptsBefore);
  assert.equal(attempts.length, 2, "un essai refusé, un réussi");
  assert.equal(attempts[0].key, attempts[1].key, "même clé d'idempotence");

  // Jeudi 8 h : désinscrit des e-mails (lien de l'e-mail) ; la veille continue. 18 h : réinscrit depuis le site.
  assert.equal((await call("/mail/preferences", { method: "PUT", body: JSON.stringify({ alerts: false }) })).status, 200);
  await pass("2026-10-29T07:00:00Z", { label: "jeu. 8 h (désinscrit)", next: "2026-10-29T17:00:00Z", mail: false });
  assert.equal((await call("/mail/preferences", { method: "PUT", body: JSON.stringify({ alerts: true }) })).status, 200);
  await pass("2026-10-29T17:00:00Z", { label: "jeu. 18 h", next: "2026-10-30T07:00:00Z" });
  await pass("2026-10-30T07:00:00Z", { label: "ven. 8 h", next: "2026-10-30T17:00:00Z" });
  await pass("2026-10-30T17:00:00Z", { label: "ven. 18 h", next: "2026-10-31T07:00:00Z" });
  await pass("2026-10-31T07:00:00Z", { label: "sam. 8 h", next: "2026-10-31T17:00:00Z" });
  await pass("2026-10-31T17:00:00Z", { label: "sam. 18 h (6 j 23 h sans visite)", next: "2026-11-01T07:00:00Z" });

  // La pastille compte tout ce qui est arrivé depuis la dernière visite (samedi 24, 18 h 30).
  assert.equal(await unseen(), await count(), "pastille : toutes les nouveautés depuis la dernière visite");
  assert.ok((await unseen())! > 100);

  // Dimanche 1er novembre 8 h : 7 jours sans visite → pause, un e-mail pour la reprendre, aucune lecture.
  setClock("2026-11-01T07:00:00Z");
  reads = [];
  const beforePause = mails.length;
  await untilWatchStarts();
  assert.equal((await row()).watched, 2, "en pause");
  assert.equal(reads.length, 0, "en pause : rien n'est lu (ni payé)");
  assert.deepEqual(mails.slice(beforePause).map(mail => mail.subject), ["Votre veille quotidienne à Lille est en pause"]);
  setClock("2026-11-01T07:30:00Z");
  reads = [];
  await idle();
  assert.equal(reads.length, 0);

  // L'utilisateur revient à 9 h, ouvre sa veille et la reprend : 18 h trouve tout depuis samedi 18 h.
  setClock("2026-11-01T08:00:00Z");
  await visit();
  assert.equal((await call(`/housing/searches/${searchId}/watch`, { method: "PUT", body: JSON.stringify({ times: ["08:00", "18:00"] }) })).status, 200);
  assert.equal((await row()).nextWatchAt, utc("2026-11-01T17:00:00Z"));
  await pass("2026-11-01T17:00:00Z", { label: "dim. 18 h (reprise)", next: "2026-11-02T07:00:00Z" });

  // Bilan sur toute la période.
  // Chaque annonce originale publiée après la création de la veille a été montrée une fois comme nouvelle.
  const created22 = utc("2026-10-22T10:00:00Z");
  const missing = ads.filter(ad => ad.repostOf == null && ad.postedAt > created22 && ad.postedAt <= utc("2026-11-01T17:00:00Z"))
    .filter(ad => !newEver.has(ad.title)).map(ad => ad.title);
  assert.deepEqual(missing, [], "aucune annonce publiée pendant la veille n'a été manquée");
  // Une annonce remontée ou republiée déjà connue n'est jamais réapparue comme nouvelle (vérifié à chaque relève) ;
  // le scénario en contient bien.
  assert.ok(ads.some(ad => ad.bumps.some(at => at > created22)), "le marché contient des remontées");
  assert.ok(ads.some(ad => ad.repostOf != null && ad.postedAt > created22), "le marché contient des republications");
  // L'IA n'analyse jamais deux fois la même annonce.
  assert.deepEqual([...analyzed].filter(([, times]) => times > 1), [], "aucune annonce analysée deux fois");
  // Les e-mails réussis ont tous une clé différente.
  const keys = mails.filter(mail => mail.status === 200).map(mail => mail.key);
  assert.equal(new Set(keys).size, keys.length);
  // Coût : la lecture reste proche de ce qui est nouveau (marge de sécurité et page relue comprises), la page 1 n'est
  // relue que rarement (première relève sans historique, rattrapage, rythme qui change d'un jour à l'autre).
  report.push(`Total : ${totals.read} annonces lues (≈ ${(totals.read / 1000).toFixed(2)} $ d'Apify) pour ${totals.fresh} nouvelles ; page 1 relue ${totals.rereads} fois`);
  assert.ok(totals.read <= 2 * totals.fresh, `lecture ${totals.read} pour ${totals.fresh} nouvelles`);
  assert.ok(totals.rereads <= 5, `page 1 relue ${totals.rereads} fois`);
  console.log(`\nBilan de la simulation (${ads.length} annonces sur le marché) :\n${report.join("\n")}`);
});
