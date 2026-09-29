import type { HousingCriterion, HousingCriterionResult, HousingFeature, HousingListing } from '@workspace/api-client-react';
import { formatPrice } from '@/components/site-shell';

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
    if (!key || isGeneral(feature.label) || seenFeatures.has(key) || requestedTopics.has(topic(feature.label)) || criterionFields.has(key) ||
      [...seenCriteria].some(label => label === key || (key.length >= 5 && (` ${label} `).includes(` ${key} `)))) continue;
    features.push(feature);
    seenFeatures.add(key);
  }
  return { generals, criteria, features };
}