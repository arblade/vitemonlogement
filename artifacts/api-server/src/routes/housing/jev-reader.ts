/**
 * Étage 2 de la lecture d'une annonce : Jev tranche ce que Le Bon Coin ne dit pas, pour les caractéristiques du
 * catalogue et les critères de l'utilisateur qui en relèvent, plus le type d'offre (logement entier, chambre…).
 *
 * Jev lit tout le catalogue sur chaque annonce (une seule requête, ≈ 0,0002 $), pas seulement les sujets cités par
 * l'utilisateur. Garde-fous (Jev ne cite pas le texte ; mesuré le 05/10 sur 188 annonces : 98,6 % de précision) :
 *  - sujets « à risque » (balcon, terrasse, duplex…, `guard`) : question posée seulement si le mot-clé apparaît ;
 *  - un « non » et toute appréciation (calme, lumineux…) ne sont retenus qu'avec la phrase de l'annonce qui les porte,
 *    affichée comme preuve ; sans phrase, un critère de l'utilisateur va au LLM, qui doit citer ;
 *  - ce que l'annonce ne dit pas n'est jamais affiché (ni « non » ni « à vérifier » : seulement si demandé) ;
 *  - une réponse n'est retenue qu'au-dessus d'un seuil de probabilité (JEV_MIN_CONFIDENCE, 0,85) ;
 *  - écarter une annonce (chambre, local) exige 0,90 (JEV_HIDE_CONFIDENCE) ET une phrase qui le montre.
 * « Non précisé » n'est jamais un « non ».
 */
import { isWeakStructured } from "./criteria";
import { CATALOGUE, catalogueFeature, catalogueFor, saysNo, sentenceWith, wantsAbsence, type CatalogueFeature } from "./catalogue";
import { criterionKey, type OfferKind, type Verdict } from "../../lib/analysis-cache";
import { jevHideConfidence, jevMinConfidence, type JevChoiceQuestion, type JevDecide } from "../../lib/jev";
import type { CriterionResult, Feature, Listing } from "./store";

const PRESENCE = { yes: "Oui, l'annonce le dit explicitement", no: "Non, l'annonce dit explicitement le contraire", unstated: "L'annonce ne le précise pas" };

const OFFER_QUESTION: JevChoiceQuestion = {
  type: "choice",
  instructions: "Qu'est-ce qui est loué dans cette annonce ?",
  criteria: {
    entire: "Un logement entier pour le locataire (studio, appartement, maison), même en résidence, même si la colocation y est possible",
    room: "Seulement une chambre ou une partie d'un logement occupé par d'autres (colocation, coliving, chez l'habitant)",
    non_dwelling: "Pas un logement : parking, garage, box, cave, local, bureau, terrain",
    unclear: "Le texte ne permet pas de trancher",
  },
};
const OFFER_EVIDENCE: Partial<Record<OfferKind, RegExp>> = {
  room: /chambre|coloc|coliving|co-living|chez\s+l.habitant|partag/i,
  non_dwelling: /parking|garage|\bbox\b|\bcave\b|local|bureau|terrain|entrep[oô]t/i,
};

/** Libellés des caractéristiques déjà données par Le Bon Coin, pour ne pas les redemander. */
const LBC_LABELS: Record<string, string[]> = {
  parking: ["Stationnement", "Parking"], furnished: ["Meublé"], elevator: ["Ascenseur"], balcony: ["Balcon"], terrace: ["Terrasse"], garden: ["Jardin"],
  outdoor: ["Balcon", "Terrasse", "Jardin"], charges_included: ["Charges comprises", "Charges"],
};

export type JevReading = {
  /** Type d'offre tranché par Jev, ou null (le LLM le lira). */
  offer: { kind: OfferKind; evidence: string } | null;
  /** Caractéristiques du catalogue tranchées (oui / non), avec la phrase de l'annonce qui en parle. */
  features: Feature[];
  /** Critères de l'utilisateur tranchés (clé : criterionKey) ; les autres restent pour le LLM. */
  verdicts: Record<string, Verdict>;
  questions: number;
  inputTokens: number | null;
};

export async function readWithJev(listing: Pick<Listing, "title" | "description" | "features">, checks: CriterionResult[], decide: JevDecide): Promise<JevReading> {
  const text = `${listing.title}\n${listing.description}`;
  // Seul un « oui » des champs fait foi ; un « non » (souvent non rempli) est revérifié dans la description.
  const known = new Set(listing.features.filter(feature => feature.source === "annonce" && !saysNo(feature.value)).map(feature => feature.label));
  const isKnown = (feature: CatalogueFeature) => (LBC_LABELS[feature.id] ?? [feature.label]).some(label => known.has(label));
  // Caractéristiques à demander : pas déjà données par Le Bon Coin ; les sujets à risque seulement s'ils sont cités.
  const asked = new Map<string, CatalogueFeature>();
  for (const feature of CATALOGUE) if (feature.id !== "outdoor" && !isKnown(feature) && (!feature.guard || feature.keyword.test(text))) asked.set(feature.id, feature);
  // Critères de l'utilisateur qui relèvent du catalogue (« balcon », « chat accepté »…), même composite (« extérieur »).
  const featureOf = (check: CriterionResult) => check.id.startsWith("wish-") ? catalogueFor(check.label) : undefined;
  const wishes = checks.filter(check => (check.status === "unknown" || isWeakStructured(check)) && featureOf(check));
  for (const check of wishes) { const feature = featureOf(check)!; if (feature.keyword.test(text)) asked.set(feature.id, feature); }

  const questions: Record<string, JevChoiceQuestion> = { offer: OFFER_QUESTION };
  for (const feature of asked.values()) questions[feature.id] = { type: "choice", instructions: feature.question, criteria: PRESENCE };
  const { answers, inputTokens } = await decide(text.slice(0, 8000), questions);

  const sure = (name: string) => { const answer = answers[name]; return answer && answer.confidence >= jevMinConfidence() ? answer.choice : null; };
  const presence = new Map<string, { value: "yes" | "no"; evidence: string }>();
  for (const feature of asked.values()) {
    const choice = sure(feature.id);
    const evidence = sentenceWith(text, feature.keyword);
    if (choice !== "yes" && choice !== "no") continue;
    if (choice === "no" && feature.yesOnly) continue;
    // Un « oui » sur un sujet sans risque se passe de phrase (« buanderie » pour le lave-linge) ; un « non » ou une appréciation, jamais.
    if (!evidence && (choice === "no" || feature.guard || feature.kind === "qualitative")) continue;
    presence.set(feature.id, { value: choice, evidence: evidence ?? "" });
  }

  const features: Feature[] = [...presence.entries()].filter(([id]) => !isKnown(catalogueFeature(id)!)).map(([id, found]) => ({
    label: catalogueFeature(id)!.label, value: found.value === "yes" ? "" : "Non", source: "ia" as const, evidence: found.evidence,
  }));
  const verdicts: Record<string, Verdict> = {};
  for (const check of wishes) {
    const found = presence.get(featureOf(check)!.id);
    if (!found?.evidence) continue; // pas tranché, ou sans phrase à citer : le LLM le lira (et devra citer)
    const satisfied = (found.value === "yes") !== wantsAbsence(check.label);
    verdicts[criterionKey(check)] = { status: satisfied ? "confirmed" : "contradicted", value: found.value === "yes" ? "Oui" : "Non", evidence: found.evidence };
  }

  let offer: JevReading["offer"] = null;
  const kind = answers.offer?.choice as OfferKind | undefined;
  if (kind === "room" || kind === "non_dwelling") {
    const evidence = sentenceWith(text, OFFER_EVIDENCE[kind]!);
    if (answers.offer.confidence >= jevHideConfidence() && evidence) offer = { kind, evidence };
  } else if ((kind === "entire" || kind === "unclear") && answers.offer.confidence >= jevMinConfidence()) {
    offer = { kind, evidence: "" };
  }
  return { offer, features, verdicts, questions: Object.keys(questions).length, inputTokens };
}
