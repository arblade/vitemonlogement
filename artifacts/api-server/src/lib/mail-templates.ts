// Gabarits des e-mails (HTML pour les messageries, texte brut en secours). HTML d'e-mail : tableaux et styles en ligne,
// largeur 560 px au plus, lisible sur mobile ; couleurs du site (rose de la marque, encre, gris).
import { parisClock } from "./paris-time";

const BRAND = "#ff385c";
const INK = "#222222";
const STONE = "#6a6a6a";
const LINE = "#dddddd";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type MailContent = { subject: string; html: string; text: string };

export type DigestListing = {
  title: string;
  price: number | null;
  area: number | null;
  rooms: number | null;
  location: string | null;
  image: string | null;
  aiSummary: string | null;
};

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const shorten = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;
const euros = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value)} €`.replace(/ /g, " ");

/** « 8 h », « 18 h 30 » : heure de Paris d'un instant. */
export function hourLabel(ms: number) {
  const { hour, minute } = parisClock(ms);
  return minute ? `${hour} h ${String(minute).padStart(2, "0")}` : `${hour} h`;
}

/** « 650 € · 40 m² · 2 pièces · Lille » */
export function facts(listing: DigestListing) {
  return [
    listing.price != null ? `${euros(listing.price)}/mois` : null,
    listing.area != null ? `${Math.round(listing.area)} m²` : null,
    listing.rooms != null ? plural(listing.rooms, "pièce", "pièces") : null,
    listing.location,
  ].filter(Boolean).join(" · ");
}

function layout(preheader: string, body: string, footer: string) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title></title></head>
<body style="margin:0;padding:0;background:#f7f7f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;font-family:${FONT};color:${INK};">
<tr><td style="padding:24px 24px 0 24px;font-size:15px;font-weight:700;color:${BRAND};">Vite mon logement</td></tr>
${body}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};"><tr><td style="padding:16px 24px;font-size:12px;line-height:1.5;color:${STONE};">${footer}</td></tr></table>
</td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${BRAND};"><a href="${escape(href)}" style="display:inline-block;padding:13px 20px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escape(label)}</a></td></tr></table>`;

function card(listing: DigestListing, href: string) {
  const image = listing.image
    ? `<tr><td style="padding:0 0 10px 0;"><a href="${escape(href)}"><img src="${escape(listing.image)}" alt="" width="512" style="display:block;width:100%;max-width:512px;height:auto;max-height:280px;object-fit:cover;border-radius:12px;border:0;"></a></td></tr>` : "";
  const summary = listing.aiSummary ? `<tr><td style="padding:4px 0 0 0;font-size:14px;line-height:1.5;color:#484848;">${escape(shorten(listing.aiSummary, 180))}</td></tr>` : "";
  return `<tr><td style="padding:16px 24px 0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #ebebeb;padding-bottom:16px;">
${image}
<tr><td style="font-size:16px;font-weight:600;line-height:1.35;"><a href="${escape(href)}" style="color:${INK};text-decoration:none;">${escape(shorten(listing.title, 90))}</a></td></tr>
<tr><td style="padding:4px 0 0 0;font-size:14px;color:${STONE};">${escape(facts(listing))}</td></tr>
${summary}
</table></td></tr>`;
}

export type DigestInput = {
  location: string;
  prompt: string;
  passAt: number;
  /** Toutes les nouvelles annonces de la relève (5 montrées au plus). */
  listings: DigestListing[];
  partial: boolean;
  searchUrl: string;
  unsubscribeUrl: string;
  email: string;
};

export const DIGEST_MAX = 5;

/** Récapitulatif d'une relève qui a trouvé de nouveaux logements. */
export function watchDigest(input: DigestInput): MailContent {
  const count = input.listings.length;
  const shown = input.listings.slice(0, DIGEST_MAX);
  const headline = `${plural(count, "nouveau logement", "nouveaux logements")} à ${input.location}`;
  const intro = `Relève de ${hourLabel(input.passAt)} de votre veille quotidienne « ${shorten(input.prompt, 80)} ».`;
  const more = count > shown.length ? `Et ${plural(count - shown.length, "autre", "autres")} sur le site.` : "";
  const partial = input.partial
    ? "Recherche très large : cette relève n’a pas pu tout lire, des annonces ont pu lui échapper. Affinez votre demande pour ne rien manquer." : "";
  const cta = count > 1 ? `Voir les ${count} nouveautés` : "Voir la nouveauté";
  const footerText = `Vous recevez cet e-mail à ${input.email} parce qu’une veille quotidienne est active sur Vite mon logement. Pour l’arrêter, ouvrez la recherche et choisissez « Arrêter ».`;
  const html = layout(`${headline}. ${intro}`, `
<tr><td style="padding:12px 24px 0 24px;font-size:22px;font-weight:700;line-height:1.3;letter-spacing:-0.02em;">${escape(headline)}</td></tr>
<tr><td style="padding:6px 24px 0 24px;font-size:14px;line-height:1.5;color:${STONE};">${escape(intro)}</td></tr>
${partial ? `<tr><td style="padding:12px 24px 0 24px;"><div style="background:#f7f7f7;border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5;color:#484848;">${escape(partial)}</div></td></tr>` : ""}
${shown.map(listing => card(listing, input.searchUrl)).join("\n")}
${more ? `<tr><td style="padding:14px 24px 0 24px;font-size:14px;color:${STONE};">${escape(more)}</td></tr>` : ""}
<tr><td style="padding:20px 24px 24px 24px;">${button(input.searchUrl, cta)}</td></tr>`,
  `${escape(footerText)}<br><a href="${escape(input.unsubscribeUrl)}" style="color:${STONE};">Ne plus recevoir ces e-mails</a>`);
  const text = [
    headline, intro, partial, "",
    ...shown.flatMap(listing => [`• ${listing.title}`, `  ${facts(listing)}`, ...(listing.aiSummary ? [`  ${shorten(listing.aiSummary, 180)}`] : []), ""]),
    more, `${cta} : ${input.searchUrl}`, "", "—", footerText, `Ne plus recevoir ces e-mails : ${input.unsubscribeUrl}`,
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
  return { subject: headline, html, text };
}

/** La veille quotidienne s'est mise en pause faute de visite. */
export function watchPaused(input: { location: string; idleDays: number; searchUrl: string; unsubscribeUrl: string; email: string }): MailContent {
  const subject = `Votre veille quotidienne à ${input.location} est en pause`;
  const intro = `Vous n’avez pas ouvert votre veille quotidienne depuis ${input.idleDays} jours : elle s’est mise en pause et ne cherche plus de nouveaux logements.`;
  const resume = "Pour la relancer, ouvrez-la et touchez « Reprendre ».";
  const footerText = `Vous recevez cet e-mail à ${input.email} parce que vous avez créé une veille quotidienne sur Vite mon logement.`;
  const html = layout(intro, `
<tr><td style="padding:12px 24px 0 24px;font-size:22px;font-weight:700;line-height:1.3;letter-spacing:-0.02em;">${escape(subject)}</td></tr>
<tr><td style="padding:8px 24px 0 24px;font-size:15px;line-height:1.55;color:#484848;">${escape(intro)} ${escape(resume)}</td></tr>
<tr><td style="padding:20px 24px 24px 24px;">${button(input.searchUrl, "Reprendre ma veille")}</td></tr>`,
  `${escape(footerText)}<br><a href="${escape(input.unsubscribeUrl)}" style="color:${STONE};">Ne plus recevoir ces e-mails</a>`);
  const text = [subject, "", intro, resume, `Reprendre ma veille : ${input.searchUrl}`, "", "—", footerText, `Ne plus recevoir ces e-mails : ${input.unsubscribeUrl}`].join("\n");
  return { subject, html, text };
}

/** Alerte d'exploitation : une veille quotidienne échoue relève après relève. */
export function watchFailing(input: { searchId: number; location: string; failures: number; error: string | null; searchUrl: string }): MailContent {
  const subject = `Veille n° ${input.searchId} (${input.location}) : ${input.failures} relèves en échec d'affilée`;
  const lines = [
    `La veille quotidienne n° ${input.searchId} (${input.location}) a échoué ${input.failures} fois d'affilée.`,
    `Dernière erreur : ${input.error || "aucun détail (voir les journaux Render)"}.`,
    "Causes fréquentes : crédit Apify ou OpenAI épuisé, acteur Apify en panne. Les journaux du service Render donnent le détail.",
  ];
  const html = layout(lines[0], `
<tr><td style="padding:12px 24px 0 24px;font-size:20px;font-weight:700;line-height:1.3;">${escape(subject)}</td></tr>
${lines.map(line => `<tr><td style="padding:8px 24px 0 24px;font-size:14px;line-height:1.55;color:#484848;">${escape(line)}</td></tr>`).join("\n")}
<tr><td style="padding:20px 24px 24px 24px;">${button(input.searchUrl, "Ouvrir la recherche")}</td></tr>`, "Alerte d’exploitation de Vite mon logement.");
  return { subject, html, text: [subject, "", ...lines, "", input.searchUrl].join("\n") };
}

/** Page de désinscription (servie par le serveur, sans connexion) : un bouton, pas d'action au simple chargement. */
export function unsubscribePage(state: "confirm" | "done" | "invalid", action = "") {
  const content = state === "confirm"
    ? `<h1>Ne plus recevoir les e-mails ?</h1><p>Vous ne recevrez plus les e-mails de votre veille quotidienne. La veille continue : ses nouveautés restent signalées sur le site.</p>
<form method="post" action="${escape(action)}"><button type="submit">Ne plus recevoir ces e-mails</button></form>`
    : state === "done"
      ? `<h1>C’est fait</h1><p>Vous ne recevrez plus les e-mails de la veille quotidienne. Vous pouvez les réactiver depuis la page de votre veille, sur le site.</p>`
      : `<h1>Lien invalide</h1><p>Ce lien de désinscription n’est pas valide. Utilisez celui du dernier e-mail reçu.</p>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vite mon logement</title>
<style>body{margin:0;background:#f7f7f7;font-family:${FONT};color:${INK}}main{max-width:480px;margin:0 auto;padding:40px 16px}
.card{background:#fff;border:1px solid ${LINE};border-radius:16px;padding:24px}.brand{color:${BRAND};font-weight:700;font-size:15px}
h1{font-size:22px;letter-spacing:-.02em;margin:12px 0 8px}p{font-size:15px;line-height:1.55;color:#484848;margin:0 0 20px}
button{height:44px;padding:0 20px;border:0;border-radius:8px;background:${BRAND};color:#fff;font-size:15px;font-weight:600;cursor:pointer}
button:hover{background:#e31c5f}</style></head>
<body><main><div class="card"><div class="brand">Vite mon logement</div>${content}</div></main></body></html>`;
}
