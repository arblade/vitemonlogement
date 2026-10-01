// Scénario de bout en bout dans un vrai navigateur : vraie API, vraie base (PGlite), front compilé.
// Mobile d'abord (usage principal), puis desktop. Les étapes se suivent : elles partagent le même serveur.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { chromium } from "playwright-core";

const base = process.env.E2E_BASE_URL ?? "http://localhost:4180";
const VIEWPORTS = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 900 } };
let browser;
let mobile;  // contexte du premier compte (celui qui adopte l'ancienne recherche)
let desktop; // contexte du second compte

const newContext = async (name) => {
  const context = await browser.newContext({ viewport: VIEWPORTS[name], isMobile: name === "mobile", hasTouch: name === "mobile", deviceScaleFactor: name === "mobile" ? 2 : 1 });
  // Aucun service externe : le fond de carte (OpenFreeMap) est remplacé par un style vide local.
  await context.route(/tiles\.openfreemap\.org/, route => route.request().url().includes("/styles/")
    ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "fond", type: "background", paint: { "background-color": "#eeeeee" } }] }) })
    : route.abort());
  return context;
};
const text = (page, selector) => page.locator(selector).first().innerText();

before(async () => { browser = await chromium.launch({ args: ["--no-sandbox"] }); mobile = await newContext("mobile"); desktop = await newContext("desktop"); });
after(async () => { await mobile?.close(); await desktop?.close(); await browser?.close(); });

test("partage du lien (WhatsApp, Signal…) : la page annonce une image PNG 1200×630 légère, à une adresse absolue, sur l'accueil comme sur un lien d'invitation", async () => {
  for (const pathname of ["/", "/?invite=Arblade"]) {
    const html = await (await fetch(base + pathname)).text(); // sans JavaScript, comme un robot d'aperçu
    const meta = name => html.match(new RegExp(`<meta[^>]+(?:property|name)="${name}"[^>]+content="([^"]*)"`))?.[1];
    assert.equal(meta("og:image"), `${base}/og-image.png`, pathname);
    assert.equal(meta("twitter:image"), `${base}/og-image.png`, pathname);
    assert.equal(meta("og:url"), `${base}/`, pathname);
    assert.match(meta("og:title"), /^Vite mon logement.*IA/, pathname);
    assert.match(meta("og:description"), /onglets/, pathname);
    assert.ok(meta("og:description")?.length > 20, pathname);
    assert.equal(meta("og:image:width"), "1200");
    assert.equal(meta("og:image:height"), "630");
    assert.ok(!html.includes("__ORIGIN__"), pathname);
  }
  const image = await fetch(`${base}/og-image.png`);
  assert.equal(image.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1200, 630], "dimensions réelles de l'image");
  assert.ok(bytes.length < 300_000, `WhatsApp refuse les images trop lourdes (${bytes.length} octets)`);
});

test("accès : sans invitation, seule la connexion est proposée (pas d'inscription libre)", async () => {
  const page = await mobile.newPage();
  await page.goto(base + "/");
  await page.waitForSelector("[data-testid=input-email]");
  assert.match(await text(page, "h1"), /Connexion/);
  assert.equal(await page.locator("[data-testid=input-password-confirm]").count(), 0);
  assert.match(await text(page, "form"), /sur invitation/);
  await page.close();
});

test("accès : un lien d'invitation invalide est refusé avec un message clair", async () => {
  const page = await mobile.newPage();
  await page.goto(base + "/?invite=mauvais-code");
  await page.waitForSelector("[data-testid=status-login-error]");
  assert.match(await text(page, "[data-testid=status-login-error]"), /pas valide/);
  assert.equal(await page.locator("[data-testid=input-password-confirm]").count(), 0);
  await page.close();
});

test("inscription (mobile) : le lien valide ouvre le formulaire, les mots de passe sont vérifiés, le code disparaît de l'URL", async () => {
  const page = await mobile.newPage();
  await page.goto(base + "/?invite=Arblade");
  await page.waitForSelector("[data-testid=input-password-confirm]");
  assert.match(await text(page, "h1"), /Créer votre compte/);
  await page.fill("[data-testid=input-email]", "Dev@Example.com");
  await page.fill("[data-testid=input-password]", "motdepasse-1");
  await page.fill("[data-testid=input-password-confirm]", "different-1");
  await page.click("[data-testid=button-login]");
  assert.match(await text(page, "[data-testid=status-login-error]"), /ne correspondent pas/);
  await page.fill("[data-testid=input-password-confirm]", "motdepasse-1");
  await page.click("[data-testid=button-login]");
  await page.waitForSelector("[data-testid=button-start-search]");
  assert.ok(!page.url().includes("invite"), page.url());
  await page.close();
});

test("le premier compte a adopté l'ancienne recherche, et ses favoris sont en base (mobile)", async () => {
  const page = await mobile.newPage();
  await page.goto(base + "/searches");
  await page.waitForSelector("[data-testid^=link-search-]");
  assert.equal(await page.locator("[data-testid^=link-search-]").count(), 1);
  await page.click("[data-testid^=link-search-]");
  await page.waitForSelector("[data-testid=card-listing-1]");
  await page.click("[data-testid=button-like-1]");
  await page.waitForFunction(() => document.querySelector("[data-testid=button-like-1]")?.getAttribute("aria-pressed") === "true");
  // Le cœur est au rose de l'app (#ff385c, jeton « brand »), rebondit au like, puis l'animation s'arrête d'elle-même.
  const heart = page.locator("[data-testid=button-like-1]");
  assert.equal(await heart.evaluate(element => getComputedStyle(element.querySelector("svg")).animationName), "heart-pop", "le cœur rebondit au like");
  await page.waitForFunction(() => !document.querySelector("[data-testid=button-like-1]")?.className.includes("heart-pop"));
  assert.equal(await heart.evaluate(element => getComputedStyle(element).color), "rgb(255, 56, 92)", "cœur au rose de l'app");
  await page.evaluate(() => localStorage.clear()); // preuve que le favori ne dépend pas du navigateur
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-testid=button-like-1]")?.getAttribute("aria-pressed") === "true");
  await page.goto(base + "/likes");
  await page.waitForSelector("article");
  assert.equal(await page.locator("article").count(), 1);
  await page.close();
});

test("galerie (mobile) : faire défiler les photos ne grise pas l'annonce, même après rechargement", async () => {
  const page = await mobile.newPage();
  await page.goto(base + "/searches/1");
  await page.waitForSelector("[data-testid=card-photo-next-1]");
  await page.click("[data-testid=card-photo-next-1]");
  await page.click("[data-testid=card-photo-next-1]");
  await page.click("[data-testid=card-photo-prev-1]");
  assert.match(await text(page, "[data-testid=card-gallery-1]"), /photo 2 \/ 3/i);
  assert.equal(await page.locator("[role=dialog]").count(), 0, "les flèches n'ouvrent pas la fiche");
  assert.doesNotMatch(await text(page, "[data-testid=card-listing-1]"), /déjà consultée/i);
  await page.reload();
  await page.waitForSelector("[data-testid=card-listing-1]");
  assert.doesNotMatch(await text(page, "[data-testid=card-listing-1]"), /déjà consultée/i);
  await page.tap("[data-testid=card-gallery-1]"); // toucher le centre de la galerie (hors boutons) ouvre la fiche complète
  await page.waitForSelector("[role=dialog]");
  await page.close();
});

test("fiche détaillée (mobile) : bouton « Voir l'annonce » visible en haut, même après défilement ; plus de bloc contact", async () => {
  const page = await mobile.newPage();
  await page.goto(base + "/searches/1");
  await page.waitForSelector("[data-testid=card-listing-1]");
  await page.click("[data-testid=button-open-listing-1]");
  const top = "[data-testid=link-detail-top-1]";
  await page.waitForSelector(top);
  assert.equal(await page.getAttribute(top, "href"), "https://www.leboncoin.fr/ad/locations/1");
  assert.match(await text(page, top), /Voir l.annonce/);
  await page.locator("[data-testid=listing-map-1]").scrollIntoViewIfNeeded();
  const box = await page.locator(top).boundingBox();
  assert.ok(box && box.y >= 0 && box.y < 200, `bouton toujours en haut après défilement (${JSON.stringify(box)})`);
  assert.equal(await page.getByText("Contacter le vendeur").count(), 0);
  assert.deepEqual(await page.locator("[data-testid=features-1] li").allInnerTexts(), ["3e étage sur 5", "Meublé", "Balcon plein sud", "Cave", "Chauffage gaz individuel"]);
  assert.doesNotMatch(await text(page, "[data-testid=features-1]"), /floor_number|donnant sur cour|Lu dans la description/);
  assert.equal(await page.locator("[data-testid=criterion-result-1-wish-1]").count(), 1);
  assert.doesNotMatch(await text(page, "[data-testid=dialog-listing-1]"), /Une information absente/);
  await page.close();
});

/** Encart carte de la fiche 1 (adresse exacte à Lille, lieu « Travail » à vélo, trajet renvoyé par le faux Google). */
async function checkListingMap(page) {
  await page.waitForSelector("[data-testid=listing-map-1]");
  assert.match(await text(page, "[data-testid=map-precision-1]"), /Adresse exacte/);
  await page.waitForSelector("[data-testid=map-marker-home]");
  assert.equal((await text(page, "[data-testid=map-marker-home]")).trim(), "", "pastille du logement : une icône, sans prix");
  assert.match(await text(page, "[data-testid=map-marker-place-1]"), /Travail/);
  await page.waitForSelector("[data-testid=map-duration-place-1]");
  assert.match(await text(page, "[data-testid=map-duration-place-1]"), /18 min/);
  await page.waitForSelector("[data-testid=listing-map-canvas][data-routes]");
  assert.equal(await page.getAttribute("[data-testid=listing-map-canvas]", "data-routes"), "1", "trajet dessiné sur la carte");
  assert.equal(await page.getAttribute("[data-testid=listing-map-canvas]", "data-crow"), "0", "pas de ligne droite quand le trajet est connu");
  assert.equal(await page.getAttribute("[data-testid=listing-map-canvas]", "data-area"), "false", "adresse exacte : pas de cercle");
  assert.match(await text(page, "[data-testid=map-travel-place-1]"), /18 min[\s\S]*à vélo · 1,4 km/);
  assert.match(await text(page, "[data-testid=map-place-place-1]"), /Gare Lille Flandres/);
  // Marche trop longue : l'utilisateur choisit le trajet affiché (vélo recommandé, coché d'office).
  assert.equal(await page.getAttribute("[data-testid=travel-choice-bike]", "aria-checked"), "true");
  assert.deepEqual(await page.locator("[role=radiogroup][aria-label='Trajet affiché'] [role=radio]").allTextContents(), ["Vélo", "Transports", "Voiture"]);
  await page.click("[data-testid=travel-choice-drive]");
  assert.equal(await page.getAttribute("[data-testid=travel-choice-drive]", "aria-checked"), "true");
  assert.match(await text(page, "[data-testid=map-travel-place-1]"), /10 min[\s\S]*en voiture/);
  await page.waitForFunction(() => /10 min/.test(document.querySelector("[data-testid=map-duration-place-1]")?.textContent ?? ""));
  const canvas = "[data-testid=listing-map-1] [data-testid=listing-map-canvas]";
  await page.waitForFunction(sel => document.querySelector(sel)?.getAttribute("data-dotted") === "1", canvas);
  assert.equal(await page.getAttribute(canvas, "data-parts"), "1", "voiture : un tracé plein, raccordé au logement en pointillés");
  // Transports : marche en pointillés, métro M1 dans sa couleur, nom de la ligne sur la carte et dans la liste.
  await page.click("[data-testid=travel-choice-transit]");
  await page.waitForFunction(() => /25 min/.test(document.querySelector("[data-testid=map-duration-place-1]")?.textContent ?? ""));
  await page.waitForFunction(sel => document.querySelector(sel)?.getAttribute("data-dotted") === "2", canvas);
  assert.equal(await page.getAttribute(canvas, "data-parts"), "1");
  assert.equal((await text(page, "[data-testid=listing-map-1] .vml-line")).trim(), "M1");
  assert.equal((await text(page, "[data-testid=map-lines-place-1]")).trim(), "M1");
  await page.click("[data-testid=travel-choice-bike]");
  await page.waitForFunction(() => /18 min/.test(document.querySelector("[data-testid=map-duration-place-1]")?.textContent ?? ""));
  assert.equal(await page.locator("[data-testid=listing-map-1] .vml-line").count(), 0);
  const box = await page.locator("[data-testid=listing-map-canvas]").boundingBox();
  assert.ok(box && box.width > 200 && box.height >= 250, `carte visible (${JSON.stringify(box)})`);
}

test("cartes (mobile puis desktop) : « Fiche complète » en bouton principal ouvre la fiche, « Voir sur … » renvoie au site, sans titres de rubrique", async () => {
  const wide = await newContext("desktop");
  try {
    const login = await wide.newPage();
    await login.goto(base + "/");
    await login.waitForSelector("[data-testid=input-email]");
    await login.fill("[data-testid=input-email]", "dev@example.com");
    await login.fill("[data-testid=input-password]", "motdepasse-1");
    await login.click("[data-testid=button-login]");
    await login.waitForSelector("[data-testid=button-start-search]");
    for (const [name, context] of [["mobile", mobile], ["desktop", wide]]) {
      const page = await context.newPage();
      await page.goto(`${base}/searches/1`);
      await page.waitForSelector("[data-testid=card-listing-2]");
      assert.match(await text(page, "[data-testid=link-source-1]"), /Voir sur Le Bon Coin/, name);
      assert.match(await text(page, "[data-testid=link-source-2]"), /Voir sur PAP/, name);
      assert.equal(await page.getAttribute("[data-testid=link-source-2]", "href"), "https://www.pap.fr/annonces/-r442803002", name);
      // En-tête des résultats : « Modifier ma demande » directement visible, pas de bloc « Affiner », « Étendre » discret.
      assert.doesNotMatch(await text(page, "body"), /Affiner votre recherche/, name);
      for (const id of ["button-edit-prompt", "button-refresh"]) {
        const box = await page.locator(`[data-testid=${id}]`).boundingBox();
        assert.ok(box && box.height >= 32 && box.x >= 0 && box.x + box.width <= page.viewportSize().width, `${name} : ${id} (${JSON.stringify(box)})`);
      }
      assert.match(await page.getAttribute("[data-testid=button-edit-prompt]", "class"), /bg-brand/, `${name} : « Modifier ma demande » en principal`);
      assert.doesNotMatch(await page.getAttribute("[data-testid=button-refresh]", "class"), /bg-brand/, `${name} : « Étendre » en secondaire`);
      const [edit, refresh] = await Promise.all(["button-edit-prompt", "button-refresh"].map(id => page.locator(`[data-testid=${id}]`).boundingBox()));
      assert.ok(edit.x < refresh.x || edit.y < refresh.y, `${name} : « Modifier ma demande » avant « Étendre »`);
      if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/resultats-entete-${name}.png` });
      const card = await text(page, "[data-testid=card-listing-1]");
      for (const gone of [/Vos critères/i, /Autres caractéristiques/i, /Détails, sources et preuves/i, /01 · Le Bon Coin/i]) assert.doesNotMatch(card, gone, name);
      // Boutons sur une ligne chacun, sans retour à la ligne du texte : principal seul (mobile) ou les trois alignés (desktop).
      const [fiche, site, compare] = await Promise.all(["button-fiche-1", "link-source-1", "button-compare-1"].map(id => page.locator(`[data-testid=${id}]`).boundingBox()));
      for (const box of [fiche, site, compare]) assert.ok(box.height <= 48, `${name} : bouton sur une ligne (${JSON.stringify(box)})`);
      assert.equal(Math.round(site.y), Math.round(compare.y), `${name} : « Voir sur » et « Comparer » côte à côte`);
      assert.ok(name === "mobile" ? fiche.y < site.y : Math.round(fiche.y) === Math.round(site.y), `${name} : place de « Fiche complète »`);
      if (process.env.E2E_SCREENSHOTS) await page.locator("[data-testid=card-listing-1]").screenshot({ path: `${process.env.E2E_SCREENSHOTS}/carte-${name}.png` });
      await page.click("[data-testid=button-fiche-1]");
      await page.waitForSelector("[data-testid=dialog-listing-1]");
      // Fiche : critères en badges, caractéristiques en liste à icônes (mots simples, sans fond).
      assert.match(await page.getAttribute("[data-testid=criterion-result-1-wish-1]", "class"), /rounded-full/, name);
      const features = await page.$$eval("[data-testid=features-1] li", items => items.map(item => ({ text: item.textContent, icon: !!item.querySelector("svg") })));
      assert.deepEqual(features.map(item => item.text), ["3e étage sur 5", "Meublé", "Balcon plein sud", "Cave", "Chauffage gaz individuel"], name);
      assert.ok(features.every(item => item.icon), `${name} : une icône par caractéristique`);
      if (process.env.E2E_SCREENSHOTS) { await page.locator("[data-testid=features-1]").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/fiche-caracteristiques-${name}.png` }); }
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=dialog-listing-1]", { state: "detached" });
      if (process.env.E2E_SCREENSHOTS) await page.locator("[data-testid=card-listing-2]").screenshot({ path: `${process.env.E2E_SCREENSHOTS}/sources-${name}.png` });
      await page.close();
    }
  } finally {
    await wide.close();
  }
});

test("chargement progressif (mobile puis desktop) : 20 annonces, puis en faisant défiler l'indicateur rose et les 20 suivantes", async () => {
  const wide = await newContext("desktop");
  try {
    const login = await wide.newPage();
    await login.goto(base + "/");
    await login.waitForSelector("[data-testid=input-email]");
    await login.fill("[data-testid=input-email]", "dev@example.com");
    await login.fill("[data-testid=input-password]", "motdepasse-1");
    await login.click("[data-testid=button-login]");
    await login.waitForSelector("[data-testid=button-start-search]");
    for (const [name, context] of [["mobile", mobile], ["desktop", wide]]) {
      const page = await context.newPage();
      // 45 annonces pour ce test seulement : on complète la vraie réponse de l'API avec des copies de la première.
      await page.route(/\/api\/housing\/searches\/1$/, async route => {
        const data = await (await route.fetch()).json();
        const extra = Array.from({ length: 42 }, (_, i) => ({ ...data.listings[0], id: 100 + i, title: `Studio copie ${i + 1}`, url: `https://www.leboncoin.fr/ad/locations/80${i}`, score: 10 - i }));
        await route.fulfill({ json: { ...data, count: 45, listings: [...data.listings, ...extra] } });
      });
      await page.goto(`${base}/searches/1`);
      await page.waitForSelector("[data-testid^=card-listing-]");
      const cards = () => page.locator("[data-testid^=card-listing-]").count();
      assert.equal(await cards(), 20, name);
      await page.locator("[data-testid=results-load-more]").scrollIntoViewIfNeeded();
      await page.waitForSelector("[data-testid=results-loader]");
      assert.match(await text(page, "[data-testid=results-loader]"), /Nous chargeons les annonces suivantes pour vous/, name);
      await page.waitForFunction(() => document.querySelectorAll("[data-testid^=card-listing-]").length === 40);
      await page.locator("[data-testid=results-load-more]").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelectorAll("[data-testid^=card-listing-]").length === 45);
      assert.equal(await page.locator("[data-testid=results-load-more]").count(), 0, `${name} : plus rien à charger`);
      await page.close();
    }
  } finally {
    await wide.close();
  }
});

test("veille quotidienne (mobile puis desktop) : la fenêtre explique, on la crée à 8 h et 18 h, bloc de nouveautés, pastille et titre d'onglet, puis on l'arrête", async () => {
  const wide = await newContext("desktop");
  try {
    const login = await wide.newPage();
    await login.goto(base + "/");
    await login.waitForSelector("[data-testid=input-email]");
    await login.fill("[data-testid=input-email]", "dev@example.com");
    await login.fill("[data-testid=input-password]", "motdepasse-1");
    await login.click("[data-testid=button-login]");
    await login.waitForSelector("[data-testid=button-start-search]");
    for (const [name, context] of [["mobile", mobile], ["desktop", wide]]) {
      const page = await context.newPage();
      await page.goto(`${base}/searches/1`);
      await page.waitForSelector("[data-testid=card-watch]");
      assert.match(await text(page, "[data-testid=card-watch]"), /Pour être prévenu des nouvelles annonces de cette recherche chaque jour, activez la veille\./, name);
      await page.click("[data-testid=button-watch]");
      await page.waitForSelector("[data-testid=dialog-watch]");
      assert.match(await text(page, "[data-testid=watch-explanation]"), /4 derniers jours[\s\S]*nouvelles annonces[\s\S]*pastille rose/, name);
      if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/suivie-fenetre-${name}.png` });
      await page.click("[data-testid=button-confirm-watch]");
      await page.waitForSelector("[data-testid=text-watch-status]:has-text('chaque jour à')");
      assert.match(await text(page, "[data-testid=text-watch-status]"), /Veille quotidienne · chaque jour à 8 h et 18 h · prochain passage (aujourd’hui|demain) à (08|18):00/, name);
      // Veille quotidienne : ni « Modifier ma demande » ni « Étendre ».
      assert.equal(await page.locator("[data-testid=button-edit-prompt], [data-testid=button-refresh]").count(), 0, `${name} : pas de boutons de recherche ponctuelle`);
      // La pastille vient du serveur ; on simule ici 2 annonces trouvées par un passage (le passage lui-même : tests serveur).
      await page.route(/\/api\/housing\/watch$/, async route => {
        const data = await (await route.fetch()).json();
        await route.fulfill({ json: { search: { ...data.search, unseenCount: 2 } } });
      });
      await page.goto(`${base}/`);
      await page.waitForSelector("[data-testid=hero-new-listings]");
      assert.match(await text(page, "[data-testid=hero-new-listings]"), /2 nouveaux logements à Lille/, name);
      assert.equal(await page.getAttribute("[data-testid=link-hero-new-listings]", "href"), "/searches/1", name);
      await page.waitForSelector(name === "mobile" ? "[data-testid=badge-unseen-menu]" : "[data-testid=badge-unseen]");
      assert.equal(await page.title(), "(2) Vite mon logement", name);
      if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/suivie-accueil-${name}.png` });
      await page.unroute(/\/api\/housing\/watch$/);
      await page.goto(`${base}/searches/1`);
      await page.click("[data-testid=button-unwatch]");
      await page.waitForSelector("[data-testid=button-watch]");
      await page.goto(`${base}/`);
      await page.waitForSelector("[data-testid=button-start-search]");
      assert.equal(await page.locator("[data-testid=card-watched-search], [data-testid=hero-new-listings]").count(), 0, `${name} : plus de veille quotidienne`);
      await page.close();
    }
  } finally {
    await wide.close();
  }
});

test("carte des résultats (mobile puis desktop) : seuls l'adresse exacte et la rue sont placés, un clic ouvre la fiche et la fermeture ramène à la carte", async () => {
  const wide = await newContext("desktop");
  try {
    const login = await wide.newPage();
    await login.goto(base + "/");
    await login.waitForSelector("[data-testid=input-email]");
    await login.fill("[data-testid=input-email]", "dev@example.com");
    await login.fill("[data-testid=input-password]", "motdepasse-1");
    await login.click("[data-testid=button-login]");
    await login.waitForSelector("[data-testid=button-start-search]");
    for (const [name, context] of [["mobile", mobile], ["desktop", wide]]) {
      const page = await context.newPage();
      await page.goto(`${base}/searches/1`);
      await page.waitForSelector("[data-testid=card-listing-3]");
      const button = "[data-testid=button-open-results-map]";
      assert.match(await text(page, button), /Carte\s*2/, name);
      assert.equal(await page.locator("[data-testid=dialog-results-map]").count(), 0, `${name} : carte fermée tant qu'on ne la demande pas`);
      const buttonBox = await page.locator(button).boundingBox();
      assert.ok(buttonBox && buttonBox.height >= 32, `${name} : bouton tactile (${JSON.stringify(buttonBox)})`);
      await page.click(button);
      await page.waitForSelector("[data-testid=results-map-canvas][data-listings='2']");
      // Pastilles de prix : annonces 1 (adresse exacte) et 3 (rue) ; l'annonce 2 (commune seule) n'est pas placée.
      await page.waitForSelector("[data-testid=results-marker-1]");
      await page.waitForSelector("[data-testid=results-marker-3]");
      assert.equal(await page.locator("[data-testid=results-marker-2]").count(), 0, `${name} : la commune seule n'est pas un point`);
      assert.match(await text(page, "[data-testid=results-marker-1]"), /600|610|620|630/, name);
      assert.match(await text(page, "[data-testid=results-place-place-1]"), /Travail/, `${name} : le lieu de travail est repéré`);
      assert.match(await text(page, "[data-testid=results-map-note]"), /2 logements sur la carte \(dont 1 d’après l’adresse citée dans la description\).*1 autre n’a qu’un quartier ou une commune/s, name);
      const viewport = page.viewportSize();
      const dialogBox = await page.locator("[data-testid=dialog-results-map]").boundingBox();
      const canvasBox = await page.locator("[data-testid=results-map-canvas]").boundingBox();
      if (name === "mobile") assert.ok(dialogBox && dialogBox.width === viewport.width && dialogBox.height === viewport.height, `mobile : plein écran (${JSON.stringify(dialogBox)})`);
      else assert.ok(dialogBox && dialogBox.width < viewport.width && dialogBox.width > 800, `desktop : grande fenêtre (${JSON.stringify(dialogBox)})`);
      assert.ok(canvasBox && canvasBox.height > 300, `${name} : carte visible (${JSON.stringify(canvasBox)})`);
      for (const id of [1, 3]) {
        const marker = await page.locator(`[data-testid=results-marker-${id}]`).boundingBox();
        assert.ok(marker && marker.height >= 32 && marker.x >= canvasBox.x && marker.x + marker.width <= canvasBox.x + canvasBox.width
          && marker.y >= canvasBox.y && marker.y + marker.height <= canvasBox.y + canvasBox.height, `${name} : pastille ${id} dans la carte et tactile (${JSON.stringify(marker)})`);
      }
      const horizontal = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(horizontal <= 0, `${name} : pas de défilement horizontal (${horizontal})`);
      if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/carte-resultats-${name}.png` });
      // Un clic sur une pastille ouvre la fiche (la carte se ferme) ; fermer la fiche ramène à la carte, qui reste utilisable.
      await page.click("[data-testid=results-marker-3]");
      await page.waitForSelector("[data-testid=dialog-listing-3]");
      await page.waitForFunction(() => document.querySelector("[data-testid=dialog-results-map]") === null);
      assert.match(await text(page, "[data-testid=dialog-listing-3]"), /Studio lumineux proche métro 3/, name);
      assert.match(await text(page, "[data-testid=map-precision-3]"), /Rue lue dans la description de l’annonce \(« situé rue Lavoisier, en plein cœur du quartier Vauban »\)/, `${name} : origine de la position dite dans la fiche`);
      await page.waitForSelector("[data-testid=dialog-listing-3] [data-testid=listing-map-canvas]");
      await page.click("[data-testid=button-close-listing-3]");
      await page.waitForSelector("[data-testid=dialog-results-map]");
      await page.waitForSelector("[data-testid=results-marker-1]");
      assert.equal(await page.getAttribute("[data-testid=results-marker-3]", "data-viewed"), "true", `${name} : annonce ouverte = consultée`);
      await page.click("[data-testid=results-marker-1]");
      await page.waitForSelector("[data-testid=dialog-listing-1]");
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=dialog-results-map]");
      // Fermer la carte rend la page à nouveau utilisable (pas de blocage des clics après l'enchaînement des fenêtres).
      await page.click("[data-testid=button-close-results-map]");
      await page.waitForFunction(() => document.querySelector("[data-testid=dialog-results-map]") === null);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).pointerEvents), "none", `${name} : page cliquable`);
      await page.click("[data-testid=button-open-listing-3]");
      await page.waitForSelector("[data-testid=dialog-listing-3]");
      await page.click("[data-testid=button-close-listing-3]");
      await page.waitForFunction(() => document.querySelector("[data-testid=dialog-listing-3]") === null);
      assert.equal(await page.locator("[data-testid=dialog-results-map]").count(), 0, `${name} : une fiche ouverte depuis la liste ne rouvre pas la carte`);
      await page.close();
    }
  } finally {
    await wide.close();
  }
});

test("carte (mobile) : adresse exacte → logement, lieu de travail, trajet et durée ; commune seule → cercle et lieu, sans trajet", async () => {
  const page = await mobile.newPage();
  await page.goto(base + "/searches/1");
  await page.waitForSelector("[data-testid=card-listing-1]");
  await page.click("[data-testid=button-open-listing-1]");
  await checkListingMap(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `défilement horizontal de ${overflow}px`);
  await page.click("[data-testid=button-close-listing-1]");
  await page.click("[data-testid=button-open-listing-2]");
  await page.waitForSelector("[data-testid=listing-map-2]");
  assert.match(await text(page, "[data-testid=map-precision-2]"), /Commune seulement/);
  await page.waitForSelector("[data-testid=dialog-listing-2] [data-testid=listing-map-canvas][data-area]");
  const zone = "[data-testid=dialog-listing-2] [data-testid=listing-map-canvas]";
  assert.equal(await page.getAttribute(zone, "data-area"), "true", "zone approximative dessinée en cercle");
  assert.equal(await page.getAttribute(zone, "data-routes"), "0", "aucun trajet depuis une zone");
  assert.equal(await page.getAttribute(zone, "data-crow"), "0", "ni ligne droite");
  assert.equal(await page.locator("[data-testid=dialog-listing-2] [data-testid=map-marker-place-1]").count(), 1, "le lieu de travail reste affiché");
  assert.equal(await page.locator("[data-testid=dialog-listing-2] [data-testid^=map-duration-]").count(), 0);
  assert.equal((await text(page, "[data-testid=dialog-listing-2] [data-testid=map-travel-place-1]")).trim(), "", "ni durée ni distance");
  await page.close();
});

test("session (mobile) : déconnexion par le menu, message générique si le mot de passe est faux, reconnexion", async () => {
  const page = await mobile.newPage();
  await page.goto(base + "/");
  await page.click("[data-testid=button-mobile-menu]");
  assert.match(await text(page, "[data-testid=nav-mobile]"), /dev@example\.com/);
  await page.click("[data-testid=button-mobile-logout]");
  await page.waitForSelector("[data-testid=input-email]");
  await page.fill("[data-testid=input-email]", "dev@example.com");
  await page.fill("[data-testid=input-password]", "mauvais");
  await page.click("[data-testid=button-login]");
  assert.match(await text(page, "[data-testid=status-login-error]"), /incorrect/);
  await page.fill("[data-testid=input-password]", "motdepasse-1");
  await page.click("[data-testid=button-login]");
  await page.waitForSelector("[data-testid=button-start-search]");
  await page.close();
});

test("isolation (desktop) : un second compte ne voit ni les recherches ni les favoris du premier", async () => {
  const page = await desktop.newPage();
  await page.goto(base + "/?invite=Arblade");
  await page.waitForSelector("[data-testid=input-password-confirm]");
  await page.fill("[data-testid=input-email]", "deuxieme@example.com");
  await page.fill("[data-testid=input-password]", "autre-motdepasse");
  await page.fill("[data-testid=input-password-confirm]", "autre-motdepasse");
  await page.click("[data-testid=button-login]");
  await page.waitForSelector("[data-testid=button-start-search]");
  await page.goto(base + "/searches");
  await page.waitForTimeout(800);
  assert.equal(await page.locator("[data-testid^=link-search-]").count(), 0);
  assert.equal(await page.evaluate(async () => (await fetch("/api/housing/searches/1")).status), 404);
  await page.goto(base + "/likes");
  await page.waitForTimeout(800);
  assert.equal(await page.locator("article").count(), 0);
  await page.close();
});

// Mise en page : chaque page, sur mobile (premier compte) et desktop (second compte), sans défilement horizontal,
// et sur mobile avec des zones tactiles d'au moins 32 px.
for (const name of ["mobile", "desktop"]) {
  test(`mise en page (${name}) : pas de défilement horizontal, zones tactiles suffisantes`, async () => {
    const page = await (name === "mobile" ? mobile : desktop).newPage();
    const pages = [["/", "[data-testid=button-start-search]"], ["/searches", "main h1"], ["/likes", "main h1"]];
    if (name === "mobile") pages.push(["/searches/1", "[data-testid=card-listing-1]"]);
    for (const [url, ready] of pages) {
      await page.goto(base + url);
      await page.waitForSelector(ready);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${name} ${url} : défilement horizontal de ${overflow}px`);
      if (name === "mobile") {
        const tiny = await page.evaluate(() => [...document.querySelectorAll("a,button")]
          .filter(element => { const r = element.getBoundingClientRect(); return r.width > 0 && (r.height < 32 || r.width < 32) && getComputedStyle(element).visibility !== "hidden" && !element.closest("[aria-hidden=true]"); })
          .map(element => `${element.tagName.toLowerCase()}[${(element.getAttribute("data-testid") || element.textContent || "").trim().slice(0, 24)}]`));
        assert.deepEqual(tiny, [], `${url} : zones tactiles trop petites`);
      }
    }
    await page.close();
  });
}

test("carte (desktop) : même encart en grand écran, pour le premier compte", async () => {
  const context = await newContext("desktop");
  const page = await context.newPage();
  await page.goto(base + "/");
  await page.waitForSelector("[data-testid=input-email]");
  await page.fill("[data-testid=input-email]", "dev@example.com");
  await page.fill("[data-testid=input-password]", "motdepasse-1");
  await page.click("[data-testid=button-login]");
  await page.waitForSelector("[data-testid=button-start-search]");
  await page.goto(base + "/searches/1");
  await page.click("[data-testid=button-open-listing-1]");
  await checkListingMap(page);
  const dialog = await page.locator("[data-testid=dialog-listing-1]").boundingBox();
  assert.ok(dialog && dialog.width >= 1000 && Math.abs(dialog.x + dialog.width / 2 - 640) < 2, `fiche centrée et large sur desktop (${JSON.stringify(dialog)})`);
  await context.close();
});
