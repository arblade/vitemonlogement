// Essai des e-mails, une fois le compte Resend prêt :
//   pnpm --filter @workspace/api-server mail:test vous@exemple.fr        → envoie un récapitulatif d'exemple (RESEND_API_KEY requise)
//   pnpm --filter @workspace/api-server mail:test --preview <dossier>    → écrit les e-mails d'exemple en HTML, sans rien envoyer
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mailConfigured, publicOrigin, sendMail } from "../src/lib/mail";
import { watchDigest, watchFailing, watchPaused, type DigestListing } from "../src/lib/mail-templates";

const sample: DigestListing[] = [
  { title: "Appartement T2 lumineux, balcon, proche métro Gambetta", price: 690, area: 42, rooms: 2, location: "Lille Wazemmes", image: "https://picsum.photos/seed/vml1/800/500", aiSummary: "T2 au 3e étage avec ascenseur, séjour lumineux exposé sud et petit balcon. Cuisine équipée, cave. Libre au 1er novembre." },
  { title: "Studio meublé rénové, centre-ville", price: 540, area: 24, rooms: 1, location: "Lille Centre", image: "https://picsum.photos/seed/vml2/800/500", aiSummary: "Studio refait à neuf, meublé, kitchenette équipée. Charges comprises." },
  { title: "T2 avec parking, quartier calme", price: 720, area: 45, rooms: 2, location: "Lille Fives", image: null, aiSummary: null },
];
const base = publicOrigin();
const digest = watchDigest({
  location: "Lille", prompt: "Un T2 à Lille, 750 € max, proche métro", passAt: Date.now(), listings: [...sample, ...sample.slice(0, 3)], partial: false,
  searchUrl: `${base}/searches/1`, unsubscribeUrl: `${base}/api/mail/unsubscribe?u=0&t=exemple`, email: "vous@exemple.fr",
});

const [first, second] = process.argv.slice(2);
if (first === "--preview") {
  const dir = path.resolve(second ?? "mail-preview");
  mkdirSync(dir, { recursive: true });
  const paused = watchPaused({ location: "Lille", idleDays: 7, searchUrl: `${base}/searches/1`, unsubscribeUrl: `${base}/api/mail/unsubscribe?u=0&t=exemple`, email: "vous@exemple.fr" });
  const failing = watchFailing({ searchId: 1, location: "Lille", failures: 3, error: "Apify run did not succeed", searchUrl: `${base}/searches/1` });
  for (const [name, mail] of [["releve", digest], ["pause", paused], ["alerte", failing]] as const) {
    writeFileSync(path.join(dir, `${name}.html`), mail.html);
    writeFileSync(path.join(dir, `${name}.txt`), `${mail.subject}\n\n${mail.text}`);
  }
  console.log(`E-mails d'exemple écrits dans ${dir}`);
} else if (first?.includes("@")) {
  if (!mailConfigured()) { console.error("RESEND_API_KEY n'est pas définie : rien n'est envoyé."); process.exit(1); }
  const id = await sendMail({ to: first, ...digest, subject: `[Essai] ${digest.subject}`, idempotencyKey: `test:${Date.now()}` });
  console.log(`E-mail d'essai envoyé à ${first} (Resend : ${id}).`);
} else {
  console.error("Usage : mail:test <adresse e-mail> | mail:test --preview <dossier>");
  process.exit(1);
}
