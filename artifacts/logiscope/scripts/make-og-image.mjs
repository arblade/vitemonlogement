// Génère public/og-image.png (1200×630), l'image affichée quand le lien est partagé (WhatsApp, Signal, iMessage…).
// À relancer après un changement de texte ou de couleur : node scripts/make-og-image.mjs
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../public/og-image.png", import.meta.url));
const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;font-family:"Liberation Sans",Arial,sans-serif;color:#222;background:#fff;position:relative;overflow:hidden}
.band{position:absolute;inset:0 auto 0 0;width:520px;background:linear-gradient(160deg,#ff385c,#e31c5f)}
.logo{position:absolute;left:72px;top:72px;width:112px;height:112px;border-radius:28px;background:#fff;display:grid;place-items:center}
.band h1{position:absolute;left:72px;top:232px;width:420px;color:#fff;font-size:70px;line-height:1.02;letter-spacing:-.03em}
.band p{position:absolute;left:72px;bottom:60px;width:410px;color:rgba(255,255,255,.9);font-size:27px;line-height:1.3}.band p b{color:#fff}
.card{position:absolute;left:590px;top:92px;width:540px;border:1px solid #ddd;border-radius:28px;padding:34px 34px 30px;box-shadow:0 20px 50px rgba(34,34,34,.12);background:#fff}
.photo{height:150px;border-radius:18px;background:linear-gradient(135deg,#ffd9e0,#ffeef1)}
.title{margin-top:24px;font-size:32px;font-weight:700;letter-spacing:-.02em}
.facts{margin-top:8px;font-size:22px;color:#6a6a6a}
.chips{margin-top:26px;display:flex;flex-wrap:wrap;gap:12px}
.chip{display:inline-flex;align-items:center;gap:9px;border-radius:999px;padding:11px 20px;font-size:23px;font-weight:600;border:2px solid}
.ok{background:#eaf7ee;border-color:#b5e0c3;color:#0b5d2f}.no{background:#fef3f2;border-color:#fecdca;color:#b42318}.unk{background:#f7f7f7;border:2px dashed #b0b0b0;color:#484848}
</style>
<div class="band">
  <div class="logo"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ff385c" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg></div>
  <h1>Vite mon logement</h1>
  <p><b>Fini les 50 onglets</b> et le bloc&#8209;notes : l’IA trie les annonces selon vos critères.</p>
</div>
<div class="card">
  <div class="photo"></div>
  <div class="title">T2 meublé · Lille</div>
  <div class="facts">750 € · 42 m² · 2 pièces</div>
  <div class="chips">
    <span class="chip ok">✓ meublé</span><span class="chip ok">✓ balcon</span>
    <span class="chip no">− parking</span><span class="chip unk">? chat accepté</span>
  </div>
</div>`;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: out, type: "png" });
await browser.close();
console.log("écrit :", out);
