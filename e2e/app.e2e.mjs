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

const newContext = (name) => browser.newContext({ viewport: VIEWPORTS[name], isMobile: name === "mobile", hasTouch: name === "mobile", deviceScaleFactor: name === "mobile" ? 2 : 1 });
const text = (page, selector) => page.locator(selector).first().innerText();

before(async () => { browser = await chromium.launch({ args: ["--no-sandbox"] }); mobile = await newContext("mobile"); desktop = await newContext("desktop"); });
after(async () => { await mobile?.close(); await desktop?.close(); await browser?.close(); });

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
  assert.doesNotMatch(await text(page, "[data-testid=card-listing-1]"), /déjà consultée/);
  await page.reload();
  await page.waitForSelector("[data-testid=card-listing-1]");
  assert.doesNotMatch(await text(page, "[data-testid=card-listing-1]"), /déjà consultée/);
  await page.close();
});

test("fiche détaillée (mobile) : ligne « Contacter le vendeur », message replié puis déplié", async () => {
  const page = await mobile.newPage();
  await page.goto(base + "/searches/1");
  await page.waitForSelector("[data-testid=card-listing-1]");
  await page.click("[data-testid=button-open-listing-1]");
  await page.waitForSelector("[data-testid=contact-1]");
  assert.match(await text(page, "[data-testid=contact-1]"), /Contacter le vendeur/);
  assert.equal(await page.getAttribute("[data-testid=contact-open-1]", "href"), "https://www.leboncoin.fr/ad/locations/1");
  assert.equal(await page.locator("[data-testid=contact-message-1]").count(), 0, "message replié par défaut");
  await page.click("[data-testid=contact-toggle-1]");
  assert.match(await page.inputValue("[data-testid=contact-message-1]"), /- chat accepté \?/);
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
