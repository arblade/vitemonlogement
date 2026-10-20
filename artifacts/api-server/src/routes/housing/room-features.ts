import type { Feature } from "./store";

/**
 * Une pièce n'est pas une caractéristique : « Chambre · 12 m² », « Cuisine · 10 m² », « Salle de bain », « WC »… Toute annonce
 * en a, l'utilisateur le sait ; ces lignes prennent la place de ce qui distingue vraiment le logement.
 *
 * Écartée : une pièce nommée seule, avec au plus une surface ou un numéro (« Chambre 2 », « Cuisine · 10 m² »).
 * Gardée : tout ce qui qualifie la pièce (« Cuisine équipée », « WC séparés », « Séjour lumineux »), les équipements
 * (« Baignoire », « Douche à l'italienne ») et les nombres des champs du site : « Chambres · 1 ch. » reste, car on peut en
 * demander un minimum ; « Salles de bain · 1 » est écarté (évident), « Salles de bain · 2 » reste.
 */
/** Minuscules, sans accents ni ponctuation (« salle d'eau » → « salle d eau »). */
const norm = (value: string) => value.toLocaleLowerCase("fr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9²]+/g, " ").trim();

const ROOM = /\b(?:chambres?|cuisine|salles? (?:de bains?|d eau|a manger)|salon|sejour|living|wc|toilettes?|entree|dressing)\b/g;
const FILLER = /\b(?:de|d|du|des|la|le|les|un|une|environ|env|approx|principale|parentale|secondaire|n|no|ch|pieces?|m|m2|metres?|carres?)\b/g;

export function isRoomNoise(feature: Pick<Feature, "label" | "value" | "source">): boolean {
  const label = norm(feature.label);
  // Champs du site : « Chambres · 1 ch. » est un nombre utile ; seule une salle de bain unique, évidente, est écartée.
  if (feature.source === "annonce") return /^salles? de bains?$/.test(label) && Number.parseInt(feature.value, 10) === 1;
  if (!ROOM.test(label)) return false;
  ROOM.lastIndex = 0;
  const rest = norm(`${feature.label} ${feature.value}`)
    .replace(ROOM, " ").replace(/\d+(?:[.,]\d+)?/g, " ").replace(/m²/g, " ").replace(FILLER, " ").replace(/[^a-z]+/g, "");
  return rest === "";
}
