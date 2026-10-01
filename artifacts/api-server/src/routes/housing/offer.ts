/**
 * Une annonce de la rubrique Locations n'est pas toujours une offre : des particuliers y publient aussi des
 * demandes (« Recherche appartement T2 », « Couple cherche studio »). On ne garde que ceux qui proposent un logement.
 * Deux verrous : le type d'annonce donné par Le Bon Coin (`offer`) et, à défaut ou en plus, le texte (titre, début
 * de la description) quand quelqu'un y dit chercher un logement.
 */

// `\b` ne reconnaît pas les lettres accentuées (« à », « é ») : bornes explicites.
const L = "a-zà-ÿ";
const HOUSING = new RegExp(`(?<![${L}0-9])(?:appartements?|apparts?|appts?|logements?|studios?|studettes?|maisons?|locations?|colocations?|chambres?|duplex|lofts?|[tf][1-6])(?![${L}0-9])`, "i");
// « à louer » = le propriétaire ; « cherche à louer » = un chercheur (le mot juste avant le dit).
const OFFERS = new RegExp(`(?<!(?:cherch|recherch)[${L}]*\\s)(?<![${L}])(?:à|a) louer(?![${L}])|(?<![${L}])(?:je|nous|on) (?:loue|louons|propose|proposons)(?![${L}])`, "i");
// Pas « recherché(e) » : c'est un adjectif (« un quartier recherché »).
const SEEKS = new RegExp(`(?<![${L}])(?:recherch|cherch)(?:e|es|ons|ent|ant)?(?![${L}])`, "gi");
// Ce qui est cherché est une personne (un propriétaire cherche des occupants), pas un logement.
const LANDLORD_SEEKS = /^\s*(?:un |une |des |nos |notre |votre )?(?:futur |futurs |bon |bons |bonne |sérieux |sérieuse )*(?:co)?(?:locataires?|couples?|étudiant\w*|personnes?|profils?|candidat\w*|dossiers?|familles?|jeunes? |salariés?|actifs?)/i;

/** Quelqu'un dit chercher un logement (et non pas : un propriétaire cherche un locataire). */
function seeksHousing(text: string) {
  for (const match of text.matchAll(SEEKS)) {
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 60);
    if (LANDLORD_SEEKS.test(after.replace(/^\s*(?:pour|d['’])\s*/i, ""))) continue;
    if (HOUSING.test(after)) return true;
  }
  return false;
}

/** Vrai si l'annonce est une demande de logement et non une offre. `adType` : champ `ad_type` / `listing_type` de l'annonce. */
export function isSeekerAd({ adType, title, description }: { adType?: unknown; title: string; description: string }): boolean {
  const type = typeof adType === "string" ? adType.trim().toLowerCase() : "";
  if (type && type !== "offer") return true; // « demand »…
  const head = description.slice(0, 200);
  if (OFFERS.test(`${title} ${head}`)) return false; // « à louer », « je loue » : c'est une offre, quoi que dise la suite
  return seeksHousing(title) || seeksHousing(head);
}

/**
 * Colocation ou chambre seule : ce n'est pas un logement entier. Repéré sans IA par le titre (« Chambre meublée à louer »,
 * « Colocation 4 chambres ») ou le texte (« Chambres dans un appartement… Colocation 4 chambres », « 2 colocataires »).
 * Un logement entier où la colocation est seulement permise (« colocation acceptée », « idéal pour colocation »,
 * « pas de colocation ») n'est pas écarté.
 */
const COLOC_OK = new RegExp(
  `(?<![${L}])(?:pas|non|sans|ni|interdite?|refus\\w*)\\s+(?:de\\s+|d['’])?coloc\\w*` +
  `|coloc\\w*\\s+(?:est\\s+|sont\\s+)?(?:non\\s+|pas\\s+)?(?:autoris|accept|possible|permis|bienvenue|envisageable|refus|interdit|exclu|déconseill|ok(?![${L}]))\\w*` +
  `|(?:idéal\\w*|parfait\\w*|adapté\\w*|conven\\w*|propice\\w*)\\s+(?:à |pour |aux )?(?:une |la |de la |les |des )?(?:coloc\\w*|colocataires)`,
  "gi",
);
const COLOC = new RegExp(`(?<![${L}])coloc(?:ation|ations|ataires?)?(?![${L}])`, "i");
const ROOM_TITLE = new RegExp(`^\\s*(?:location\\s+(?:de\\s+)?)?(?:\\d+\\s+)?chambres?(?![${L}])|(?<![${L}])chambre\\s+(?:chez|dans|en)\\s+`, "i");
const ROOM_IN_FLAT = new RegExp(`(?<![${L}])chambres?\\s+(?:meublées?\\s+)?(?:dans|au sein d['’]?)\\s+(?:un|une|le|la|l['’])\\s*(?:grand\\s+|petit\\s+)?(?:appartement|maison|logement|colocation|villa)`, "i");

export function isColocationAd({ title, description }: { title: string; description: string }): boolean {
  if (ROOM_TITLE.test(title)) return true;
  const text = `${title} \n${description}`.replace(COLOC_OK, " ");
  return COLOC.test(text) || ROOM_IN_FLAT.test(text);
}
