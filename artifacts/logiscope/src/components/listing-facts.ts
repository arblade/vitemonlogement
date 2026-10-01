import type { HousingCriterion, HousingCriterionResult, HousingFeature, HousingListing } from '@workspace/api-client-react';
import { ArrowUpDown, Bath, BedDouble, Building2, Car, Check, CookingPot, DoorOpen, Euro, Flame, Leaf, MapPin, Receipt, Ruler, Sofa, Sun, Trees, Warehouse, Wifi, Zap, type LucideIcon } from 'lucide-react';
import { formatPrice } from '@/components/site-shell';

/** Icône (trait fin) de chaque repère essentiel, partagée par la carte et la fiche détaillée. */
export const generalIcons: Record<string, LucideIcon> = { Prix: Euro, Surface: Ruler, Pièces: DoorOpen, Localisation: MapPin };

const normalize = (text: string) => text.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const generalKeys = new Set(['prix', 'price', 'budget', 'surface', 'superficie', 'area', 'surface habitable', 'pieces', 'piece', 'rooms', 'nombre de pieces', 'localisation', 'lieu', 'location', 'adresse', 'ville', 'quartier']);
const generalFields = new Set(['price', 'area', 'rooms', 'location', 'prix', 'surface', 'pieces', 'localisation']);
const generalIds = new Set(['price', 'area', 'rooms', 'location']);

function isGeneral(label: string, apiField?: string | null) {
  return generalKeys.has(normalize(label)) || (apiField != null && generalFields.has(normalize(apiField)));
}

function topic(label: string) {
  const key = normalize(label);
  if (/\b(parking|stationnement|garage)\b/.test(key)) return 'parking';
  if (/\b(meuble|ameuble)\b/.test(key)) return 'furnished';
  if (/\b(ascenseur|elevator)\b/.test(key)) return 'elevator';
  if (/\b(balcon|balcony)\b/.test(key)) return 'balcony';
  if (/\b(terrasse|terrace)\b/.test(key)) return 'terrace';
  // Diagnostics : « Classe énergie » du site et « DPE » relu par l'IA sont la même information, idem pour le GES.
  if (/\b(dpe|classe energie|classe energetique|diagnostic de performance energetique|performance energetique|etiquette energie)\b/.test(key)) return 'dpe';
  if (/\b(ges|gaz a effet de serre|emissions? de ges|emissions? de gaz)\b/.test(key)) return 'ges';
  return key;
}

export function listingFacts(listing: HousingListing, checks: HousingCriterion[]) {
  const generals = [
    { label: 'Prix', value: listing.price != null ? formatPrice(listing.price) : 'Non précisé' },
    { label: 'Surface', value: listing.area != null ? `${listing.area} m²` : 'Non précisée' },
    { label: 'Pièces', value: listing.rooms != null ? `${listing.rooms} pièce${listing.rooms > 1 ? 's' : ''}` : 'Non précisées' },
    { label: 'Localisation', value: listing.location?.trim() || 'Non précisée' },
  ];
  const results = listing.criterionResults || [];
  const criteria: HousingCriterionResult[] = [];
  const seenCriteria = new Set<string>();
  const seenIds = new Set<string>();
  const criterionFields = new Set(checks.map(check => normalize(check.apiField || '')).filter(Boolean));
  for (const check of checks) {
    if (generalIds.has(check.id) || isGeneral(check.label, check.apiField) || seenCriteria.has(normalize(check.label)) || seenIds.has(check.id)) continue;
    const result = results.find(item => item.id === check.id || normalize(item.label) === normalize(check.label));
    criteria.push(result ? { ...result, label: check.label } : {
      id: check.id, label: check.label, status: 'unknown', source: 'unknown', value: '', evidence: '',
    });
    seenCriteria.add(normalize(check.label));
    seenIds.add(check.id);
  }
  for (const result of results) {
    const key = normalize(result.label);
    if (generalIds.has(result.id) || isGeneral(result.label) || seenCriteria.has(key) || seenIds.has(result.id)) continue;
    criteria.push(result);
    seenCriteria.add(key);
    seenIds.add(result.id);
  }
  const features: HousingFeature[] = [];
  const seenFeatures = new Set<string>();
  const requestedTopics = new Set(criteria.map(item => topic(item.label)));
  for (const feature of listing.features || []) {
    const key = normalize(feature.label);
    const kind = topic(feature.label);
    if (!key || isGeneral(feature.label) || requestedTopics.has(kind) || criterionFields.has(key) ||
      [...seenCriteria].some(label => label === key || (key.length >= 5 && (` ${label} `).includes(` ${key} `)))) continue;
    if (seenFeatures.has(kind)) {
      // Même sujet déjà listé : on garde la première, sauf si c'est le même libellé et que celle-ci précise la valeur (« Cave » puis « Cave privative »).
      const at = features.findIndex(other => topic(other.label) === kind);
      if (at >= 0 && normalize(features[at].label) === key && !features[at].value && feature.value) features[at] = feature;
      continue;
    }
    features.push(feature);
    seenFeatures.add(kind);
  }
  return { generals, criteria, features: dropRepeats(features) };
}

/** « Non », « Aucun » : la caractéristique est absente du logement (affichée barrée dans la fiche). */
export const isAbsent = (feature: Pick<HousingFeature, 'value'>) => ['non', 'aucun', 'aucune'].includes(normalize(feature.value || ''));

/** Une caractéristique dont tous les mots sont déjà dans une autre, plus précise, n'est pas répétée (« Chauffage collectif » / « Chauffage collectif gaz »). */
function dropRepeats<T extends Pick<HousingFeature, 'label' | 'value'>>(features: T[]): T[] {
  const sets = features.map(feature => new Set(words(featureText(feature))));
  const contains = (big: Set<string>, small: Set<string>) => [...small].every(word => big.has(word));
  return features.filter((_, i) => !features.some((__, j) => j !== i && contains(sets[j], sets[i]) && (sets[j].size > sets[i].size || j < i)));
}

const lower = (text: string) => text.charAt(0).toLocaleLowerCase('fr') + text.slice(1);

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('fr') + text.slice(1);
const stem = (word: string) => word.replace(/[sx]$/, '');
const words = (text: string) => normalize(text).split(' ').filter(Boolean).map(stem);

/**
 * Assemble libellé et valeur sans répéter de mots : l'IA renvoie parfois « Balcon » + « vue dégagée sur le balcon »,
 * « Eau froide » + « eau froide collective » ou « Étage » + « 18e étage ». Valeur qui contient le libellé → la valeur ;
 * valeur déjà dans le libellé → le libellé ; mots communs à la jonction → fusionnés ; sinon libellé puis valeur.
 */
function joinWithoutRepeat(label: string, value: string) {
  const l = words(label), v = words(value);
  if (l.length && l.every(word => v.includes(word))) return capitalize(value);
  if (v.length && v.every(word => l.includes(word))) return label;
  for (let k = Math.min(l.length, v.length) - 1; k >= 1; k--) {
    if (l.slice(-k).join(' ') === v.slice(0, k).join(' ')) return `${label} ${value.split(/\s+/).slice(k).join(' ')}`;
  }
  return `${label} ${value}`.replace(/\s+/g, ' ');
}

/** Une caractéristique en mots simples, lisible d'un coup d'œil : « 3e étage », « Sans ascenseur », « DPE D », « 1 chambre ». */
export function featureText(feature: Pick<HousingFeature, 'label' | 'value'>) {
  const label = feature.label.trim(), value = (feature.value || '').trim(), key = normalize(label), v = normalize(value);
  if (v === 'non' || v === 'aucun' || v === 'aucune') return key === 'meuble' ? 'Non meublé' : `Sans ${lower(label)}`;
  if (!value || v === 'oui') return label;
  if (key === 'etage') {
    if (/^(rdc|0|rez de chaussee)$/.test(v)) return 'Rez-de-chaussée';
    const floor = v.match(/^(\d+)(?: ?(?:e|er|eme))?(?: sur (\d+))?$/);
    return floor ? `${floor[1] === '1' ? '1er' : `${floor[1]}e`} étage${floor[2] ? ` sur ${floor[2]}` : ''}` : joinWithoutRepeat(label, value);
  }
  if (key === 'chambres') { const n = parseInt(value, 10); return Number.isFinite(n) ? `${n} chambre${n > 1 ? 's' : ''}` : `Chambres : ${value}`; }
  if (key === 'salles de bain') { const n = parseInt(value, 10); return Number.isFinite(n) ? `${n} salle${n > 1 ? 's' : ''} de bain` : `Salles de bain : ${value}`; }
  if (key === 'classe energie') return `DPE ${value.toLocaleUpperCase('fr')}`;
  if (key === 'emissions ges') return `GES ${value.toLocaleUpperCase('fr')}`;
  return joinWithoutRepeat(label, value);
}

const featureIcons: [RegExp, LucideIcon][] = [
  [/\b(ascenseur)\b/, ArrowUpDown], [/\b(etage)\b/, Building2], [/\b(chambres?)\b/, BedDouble], [/\b(salles? de bain|salle d eau|douche)\b/, Bath],
  [/\b(classe energie|dpe)\b/, Zap], [/\b(ges|emissions)\b/, Leaf], [/\b(chauffage)\b/, Flame], [/\b(charges|honoraires|depot)\b/, Receipt],
  [/\b(parking|stationnement|garage|box)\b/, Car], [/\b(meuble)\b/, Sofa], [/\b(balcon|terrasse|loggia|exposition)\b/, Sun], [/\b(jardin)\b/, Trees],
  [/\b(cave|cellier|grenier)\b/, Warehouse], [/\b(cuisine)\b/, CookingPot], [/\b(fibre|internet|wifi)\b/, Wifi],
];
/** Icône au trait de chaque caractéristique (repère visuel, toujours accompagné du texte) ; coche discrète par défaut. */
export function featureIcon(label: string): LucideIcon {
  const key = normalize(label);
  return featureIcons.find(([pattern]) => pattern.test(key))?.[1] ?? Check;
}

const featureRanks: [RegExp, number][] = [
  [/\b(chambres?)\b/, 0], [/\b(salles? de bain|salle d eau)\b/, 1], [/\b(etage)\b/, 2], [/\b(ascenseur)\b/, 3],
  [/\b(chauffage)\b/, 5], [/\b(classe energie|dpe)\b/, 6], [/\b(ges|emissions)\b/, 7], [/\b(charges|honoraires|depot)\b/, 8],
];
/** Ordre de lecture : pièces et étage, équipements, chauffage et énergie, charges ; ce qui manque en dernier. */
export function sortFeatures<T extends Pick<HousingFeature, 'label' | 'value'>>(features: T[]): T[] {
  const rank = (feature: T) => (isAbsent(feature) ? 100 : 0) + (featureRanks.find(([pattern]) => pattern.test(normalize(feature.label)))?.[1] ?? 4);
  return features.map((feature, index) => ({ feature, index })).sort((a, b) => rank(a.feature) - rank(b.feature) || a.index - b.index).map(({ feature }) => feature);
}
