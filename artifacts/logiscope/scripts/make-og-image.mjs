// Génère public/og-image.png (1200×630), l'image affichée quand le lien est partagé (WhatsApp, Signal, iMessage…).
// À relancer après un changement de texte ou de couleur : node scripts/make-og-image.mjs
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../public/og-image.png", import.meta.url));
const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;font-family:"Liberation Sans",Arial,sans-serif;color:#fff;background:linear-gradient(150deg,#ff385c,#e31c5f);position:relative;overflow:hidden}
.deco{position:absolute;right:-150px;top:-120px;opacity:.12}
.logo{position:absolute;left:84px;top:76px;width:104px;height:104px;border-radius:26px;background:#fff;display:grid;place-items:center}
h1{position:absolute;left:84px;top:236px;font-size:98px;line-height:1;letter-spacing:-.035em}
.tag{position:absolute;left:84px;top:372px;width:900px;font-size:46px;line-height:1.2;letter-spacing:-.01em;font-weight:700}
.sub{position:absolute;left:84px;bottom:76px;font-size:31px;color:rgba(255,255,255,.88)}
</style>
<svg class="deco" width="720" height="720" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
<div class="logo"><svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#ff385c" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg></div>
<h1>Vite mon logement</h1>
<div class="tag">Décrivez le logement que vous cherchez.<br>L’IA trie les annonces à votre place.</div>
<div class="sub">Fini les 50 onglets et le bloc&#8209;notes.</div>`;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: out, type: "png" });
await browser.close();
console.log("écrit :", out);
