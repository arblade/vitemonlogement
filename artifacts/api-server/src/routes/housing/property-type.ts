// Type de bien demandé (maison ou appartement) : un vrai critère de recherche, pas seulement un mot-clé.
// Le Bon Coin classe chaque annonce (`real_estate_type`) : 1 Maison, 2 Appartement, 3 Terrain, 4 Parking, 5 Autre.
export type PropertyType = "house" | "apartment";

/** Classe du diagnostic de performance énergétique : A (la meilleure) à G. */
export const ENERGY_CLASSES = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type EnergyClass = (typeof ENERGY_CLASSES)[number];
export const isEnergyClass = (value: unknown): value is EnergyClass => typeof value === "string" && (ENERGY_CLASSES as readonly string[]).includes(value);

export const isPropertyType = (value: unknown): value is PropertyType => value === "house" || value === "apartment";

/**
 * Types demandés à Le Bon Coin. La catégorie 5 (« Autre ») est gardée dans les deux cas : un logement atypique (chalet,
 * péniche…) n'y est pas écarté d'avance ; chambres et colocations qui s'y glissent le sont ensuite par la lecture.
 */
export const REAL_ESTATE_TYPES = { house: "1,5", apartment: "2,5", any: "1,2" } as const;
export const realEstateTypes = (wanted: PropertyType | null | undefined) => REAL_ESTATE_TYPES[wanted ?? "any"];

/** Ce que dit l'annonce : « Maison » / « 1 », « Appartement » / « 2 », « Autre » / « 5 » ; null si elle ne le dit pas. */
export function declaredType(value: string): PropertyType | "other" | null {
  const type = value.trim().toLocaleLowerCase("fr");
  if (type === "1" || type === "maison" || type === "house") return "house";
  if (type === "2" || type === "appartement" || type === "apartment") return "apartment";
  if (type === "5" || type === "autre") return "other";
  return null;
}

// Mots du titre qui disent clairement le type : une annonce mal classée par son auteur (« Maison T4 » rangée en
// « Appartement ») reste affichée. Pour un appartement, « T3 » ne suffit pas : on le trouve aussi dans des maisons.
const TITLE_WORDS = {
  house: /(?<![\p{L}\d])(?:maisons?|pavillons?|villas?|long[èe]res?|fermettes?|bastides?|chalets?)(?![\p{L}\d])/iu,
  apartment: /(?<![\p{L}\d])(?:appartements?|apparts?|studios?|studettes?|duplex|triplex|lofts?)(?![\p{L}\d])/iu,
} as const;

/**
 * L'annonce correspond-elle au type demandé ? Elle n'est écartée que si elle se déclare clairement de l'autre type et
 * que son titre ne dit pas le contraire : « Autre », type absent ou titre explicite → on la garde (mieux vaut une annonce
 * de trop qu'une maison perdue).
 */
export function matchesPropertyType(wanted: PropertyType | null | undefined, declared: ReturnType<typeof declaredType>, title: string) {
  if (!wanted || declared == null || declared === "other" || declared === wanted) return true;
  return TITLE_WORDS[wanted].test(title);
}
