/**
 * Catalogue des caractéristiques d'un logement, lues en trois étages, du plus sûr au plus cher :
 *  1. Le Bon Coin (champs structurés renvoyés par Apify) : gratuit et certain ;
 *  2. Jev (TypeSafe, décisions typées) : pour ce que Le Bon Coin ne dit pas, si le sujet apparaît dans le texte ;
 *  3. le LLM : les critères qui ne relèvent pas du catalogue (« calme », « proche de mon travail »…), le résumé, l'adresse.
 *
 * Pour chaque caractéristique : ce qui la reconnaît dans un souhait de l'utilisateur (`wish`), les mots qui doivent
 * figurer dans l'annonce pour qu'une réponse de Jev soit retenue (`keyword` : garde-fou contre l'invention, et la phrase
 * qui les contient sert de preuve), la question posée à Jev, et la lecture des champs Le Bon Coin quand ils existent.
 * Une information absente n'est jamais un « non » : seule une case cochée ou un champ explicite tranche.
 */
import { apiValue } from "./criteria";

export type Presence = "yes" | "no";

export type CatalogueFeature = {
  id: string;
  /** Libellé affiché (et reconnu par les icônes du site). */
  label: string;
  /** Souhait de l'utilisateur qui porte sur cette caractéristique. */
  wish: RegExp;
  /** Mots qui doivent apparaître dans l'annonce pour retenir une réponse de Jev ; la phrase qui les contient sert de preuve. */
  keyword: RegExp;
  /** Question posée à Jev (oui / non / non précisé). */
  question: string;
  /** Lecture certaine des champs Le Bon Coin ; null si rien n'est dit. */
  structured?: (raw: Record<string, unknown>) => Presence | null;
};

/** Cases cochées par l'annonceur dans « Spécificités » (« Cave, Interphone, Animaux autorisés… »), en minuscules. */
export function specificities(raw: Record<string, unknown>): string[] {
  const values: unknown[] = [];
  const attributes = Array.isArray(raw.attributes) ? raw.attributes : [];
  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== "object" || (attribute as { key?: unknown }).key !== "specificities") continue;
    const data = attribute as Record<string, unknown>;
    values.push(data.values_label, data.value_label, data.values, data.value);
  }
  if (!values.length) values.push(raw.specificities);
  return values.flatMap(value => Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [])
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim().toLocaleLowerCase("fr")).filter(Boolean);
}

const ticked = (pattern: RegExp) => (raw: Record<string, unknown>): Presence | null =>
  specificities(raw).some(value => pattern.test(value)) ? "yes" : null;

const yesNo = (key: string) => (raw: Record<string, unknown>): Presence | null => {
  const value = apiValue(raw, key);
  if (value === true || value === 1) return "yes";
  if (value === false || value === 0) return "no";
  const text = typeof value === "string" ? value.trim().toLocaleLowerCase("fr") : "";
  if (/^(oui|yes|true|1)$/.test(text)) return "yes";
  if (/^(non|no|false|0)$/.test(text)) return "no";
  return null;
};

const either = (...readers: ((raw: Record<string, unknown>) => Presence | null)[]) => (raw: Record<string, unknown>) => {
  const answers = readers.map(read => read(raw));
  return answers.includes("yes") ? "yes" : answers.includes("no") ? "no" : null;
};

function floorProperty(raw: Record<string, unknown>) {
  const value = apiValue(raw, "floor_property");
  return (Array.isArray(value) ? value.join(" ") : String(value ?? "")).toLocaleLowerCase("fr");
}

export const CATALOGUE: CatalogueFeature[] = [
  { id: "parking", label: "Parking", wish: /parking|stationnement|garage|\bbox\b/i, keyword: /parking|stationnement|garage|\bbox\b|place\s+de\s+parc/i,
    question: "Le logement dispose-t-il d'une place de parking, d'un garage ou d'un box (inclus ou en option) ?",
    structured: raw => {
      if (ticked(/garage|parking/)(raw) === "yes") return "yes";
      const count = Number(apiValue(raw, "nb_parkings"));
      return apiValue(raw, "nb_parkings") == null || !Number.isFinite(count) ? null : count > 0 ? "yes" : "no";
    } },
  { id: "furnished", label: "Meublé", wish: /meubl/i, keyword: /meubl|[ée]quip[ée]\s+de\s+meubles/i,
    question: "Le logement est-il loué meublé ?",
    structured: raw => {
      const value = String(apiValue(raw, "furnished") ?? "").toLocaleLowerCase("fr");
      if (/^non[\s-]*meubl|^non$|^false$|^0$/.test(value)) return "no";
      if (/^meubl|^oui$|^true$|^1$/.test(value)) return "yes";
      return null;
    } },
  { id: "elevator", label: "Ascenseur", wish: /ascenseur/i, keyword: /ascenseur/i, question: "L'immeuble a-t-il un ascenseur ?", structured: yesNo("elevator") },
  { id: "balcony", label: "Balcon", wish: /balcon|loggia/i, keyword: /balcon|loggia/i, question: "Le logement a-t-il un balcon ou une loggia ?", structured: yesNo("balcony") },
  { id: "terrace", label: "Terrasse", wish: /terrasse/i, keyword: /terrasse/i, question: "Le logement a-t-il une terrasse ?", structured: yesNo("terrace") },
  { id: "garden", label: "Jardin", wish: /jardin/i, keyword: /jardin/i, question: "Le logement a-t-il un jardin (privatif ou commun) ?", structured: yesNo("garden") },
  { id: "outdoor", label: "Extérieur", wish: /ext[ée]rieur/i, keyword: /balcon|loggia|terrasse|jardin|ext[ée]rieur|cour\b/i,
    question: "Le logement a-t-il un espace extérieur (balcon, loggia, terrasse, jardin ou cour) ?",
    structured: either(yesNo("balcony"), yesNo("terrace"), yesNo("garden")) },
  { id: "cellar", label: "Cave", wish: /\bcave\b|cellier/i, keyword: /\bcaves?\b|cellier/i, question: "Le logement dispose-t-il d'une cave ou d'un cellier ?", structured: ticked(/\bcave\b/) },
  { id: "bike", label: "Local vélo", wish: /v[ée]lo/i, keyword: /v[ée]los?/i, question: "L'immeuble a-t-il un local ou un parking à vélos ?" },
  { id: "kitchen", label: "Cuisine équipée", wish: /cuisine\s+([ée]quip|am[ée]nag)/i, keyword: /cuisine/i,
    question: "La cuisine est-elle équipée (plaques, four ou réfrigérateur fournis) ?", structured: ticked(/cuisine [ée]quip/) },
  { id: "dishwasher", label: "Lave-vaisselle", wish: /lave[\s-]*vaisselle/i, keyword: /lave[\s-]*vaisselle/i, question: "Un lave-vaisselle est-il fourni ?" },
  { id: "washer", label: "Lave-linge", wish: /lave[\s-]*linge|machine\s+[àa]\s+laver/i, keyword: /lave[\s-]*linge|machine\s+[àa]\s+laver|buanderie/i, question: "Un lave-linge (ou une buanderie avec lave-linge) est-il disponible ?" },
  { id: "bathtub", label: "Baignoire", wish: /baignoire/i, keyword: /baignoire/i, question: "La salle de bain a-t-elle une baignoire ?" },
  { id: "separate_wc", label: "WC séparés", wish: /wc\s+s[ée]par|toilettes?\s+s[ée]par/i, keyword: /\bwc\b|toilettes?/i, question: "Les WC sont-ils séparés de la salle de bain ?" },
  { id: "double_glazing", label: "Double vitrage", wish: /double[\s-]*vitrage/i, keyword: /vitrage/i, question: "Les fenêtres sont-elles en double vitrage ?" },
  { id: "air_conditioning", label: "Climatisation", wish: /clim/i, keyword: /clim/i, question: "Le logement est-il climatisé ?" },
  { id: "fireplace", label: "Cheminée", wish: /chemin[ée]e/i, keyword: /chemin[ée]e/i, question: "Le logement a-t-il une cheminée ?" },
  { id: "parquet", label: "Parquet", wish: /parquet/i, keyword: /parquet/i, question: "Le sol est-il en parquet ?" },
  { id: "intercom", label: "Interphone", wish: /interphone|digicode|visiophone/i, keyword: /interphone|digicode|visiophone/i,
    question: "L'immeuble a-t-il un interphone, un visiophone ou un digicode ?", structured: ticked(/interphone|digicode|visiophone/) },
  { id: "caretaker", label: "Gardien", wish: /gardien|concierge/i, keyword: /gardien|concierge/i, question: "L'immeuble a-t-il un gardien ou un concierge ?", structured: ticked(/gardien|concierge/) },
  { id: "pets", label: "Animaux acceptés", wish: /animal|animaux|\bchats?\b|\bchiens?\b/i, keyword: /animal|animaux|\bchats?\b|\bchiens?\b/i,
    question: "Les animaux de compagnie sont-ils acceptés ?", structured: ticked(/animaux autoris/) },
  { id: "flatshare", label: "Colocation acceptée", wish: /colocation|coloc\b/i, keyword: /coloc/i, question: "Le logement entier peut-il être loué en colocation ?" },
  { id: "students", label: "Étudiants acceptés", wish: /[ée]tudiant/i, keyword: /[ée]tudiant/i, question: "Les étudiants sont-ils acceptés comme locataires ?" },
  { id: "visale", label: "Garantie Visale", wish: /visale/i, keyword: /visale/i, question: "La garantie Visale est-elle acceptée ?" },
  { id: "apl", label: "APL possible", wish: /\bapl\b|aide\s+au\s+logement|\bcaf\b/i, keyword: /\bapl\b|\bcaf\b|aide\s+au\s+logement/i, question: "Le logement est-il éligible aux APL (aide au logement de la CAF) ?" },
  { id: "no_fees", label: "Sans frais d'agence", wish: /sans\s+frais|sans\s+agence|particulier/i, keyword: /frais\s+d.agence|honoraires|sans\s+frais|particulier/i,
    question: "La location se fait-elle sans frais d'agence (de particulier à particulier) ?" },
  { id: "charges_included", label: "Charges comprises", wish: /charges?\s+compris|cc\b/i, keyword: /charges?|\bcc\b/i, question: "Les charges sont-elles comprises dans le loyer ?", structured: yesNo("charges_included") },
  { id: "renovated", label: "Rénové", wish: /r[ée]nov|refait|neuf/i, keyword: /r[ée]nov|refait|neuf/i, question: "Le logement est-il refait à neuf ou récemment rénové ?",
    structured: raw => /neuf|r[ée]nov/i.test(String(apiValue(raw, "global_condition") ?? "")) ? "yes" : null },
  { id: "top_floor", label: "Dernier étage", wish: /dernier\s+[ée]tage/i, keyword: /dernier\s+[ée]tage/i, question: "Le logement est-il au dernier étage ?",
    structured: raw => /dernier [ée]tage/.test(floorProperty(raw)) ? "yes" : null },
  { id: "ground_floor", label: "Rez-de-chaussée", wish: /rez[\s-]*de[\s-]*chauss|\brdc\b/i, keyword: /rez[\s-]*de[\s-]*chauss|\brdc\b/i, question: "Le logement est-il au rez-de-chaussée ?",
    structured: raw => {
      if (/pas de rez/.test(floorProperty(raw))) return "no";
      const floor = apiValue(raw, "floor_number");
      return floor == null ? null : Number(floor) === 0 ? "yes" : Number.isFinite(Number(floor)) ? "no" : null;
    } },
  { id: "duplex", label: "Duplex", wish: /duplex|mezzanine/i, keyword: /duplex|mezzanine/i, question: "Le logement est-il en duplex ou avec mezzanine ?" },
  { id: "transport", label: "Proche transports", wish: /m[ée]tro|tram|gare|transport|\bbus\b/i, keyword: /m[ée]tro|tram|gare|transports?|\bbus\b|\brer\b/i,
    question: "L'annonce dit-elle qu'un métro, tram, bus ou une gare est accessible à pied ?" },
];

const byId = new Map(CATALOGUE.map(feature => [feature.id, feature]));
export const catalogueFeature = (id: string | null | undefined) => (id ? byId.get(id) : undefined);

/** Caractéristique du catalogue visée par un souhait (« balcon », « chat accepté »…) ; undefined : critère « complexe » (LLM). */
export function catalogueFor(wish: string) {
  // Une phrase de plus de 6 mots (« calme et proche de mon travail ») reste au LLM, même si elle cite un mot connu.
  if (wish.trim().split(/\s+/).length > 6) return undefined;
  return CATALOGUE.find(feature => feature.wish.test(wish));
}

/** « sans ascenseur », « pas de rez-de-chaussée », « non meublé » : on veut que la caractéristique soit absente. */
export const wantsAbsence = (wish: string) => /\b(sans|pas\s+(de|au|d')|non[\s-])/i.test(wish);

/**
 * « Non » lu dans un champ Le Bon Coin (« Ascenseur : Non », « 0 place(s) ») : souvent une valeur par défaut que le
 * propriétaire n'a pas remplie. Ce n'est pas une certitude : la description est lue quand même, et un « oui » explicite
 * y l'emporte. Un « oui » coché, lui, est une déclaration : il fait foi.
 */
export const saysNo = (value: string) => /^(non|0 place\(s\)|0)$/i.test(value.trim());

/** Phrase de l'annonce qui contient le mot-clé (preuve affichée), ou null si le sujet n'y apparaît pas. */
export function sentenceWith(text: string, keyword: RegExp) {
  const sentences = text.split(/(?<=[.!?;])\s+|\n+/).map(value => value.trim()).filter(Boolean);
  const found = sentences.find(sentence => keyword.test(sentence));
  return found ? found.slice(0, 220) : null;
}
