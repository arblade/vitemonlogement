/**
 * Cas du banc d'essai. Chaque cas : une demande, la réponse du LLM d'interprétation (simulée tant qu'aucun relevé réel
 * n'existe, voir README.md), ce que l'interprétation doit donner, et des annonces avec ce qu'une bonne application
 * devrait en faire (« visible » ou « écartée »).
 *
 * Les attendus décrivent le comportement SOUHAITÉ, pas l'actuel : un cas peut échouer aujourd'hui. Le rapport dit à
 * quelle étape chaque annonce est perdue ; baseline.json garde l'état actuel pour repérer progrès et régressions.
 */
import type { BenchAd, BenchCase } from "./types";

// Réponse du LLM d'interprétation au format demandé par le prompt de `interpret()`.
const raw = (partial: Record<string, unknown>) => ({
  location: "", intent: "rent", minPrice: null, maxPrice: null, minArea: null, maxArea: null, minRooms: null, maxRooms: null,
  minBedrooms: null, minEnergyClass: null, radius: 5, keywords: "", propertyType: null, uncertainChecks: [], places: [], ...partial,
});
const simulated = (partial: Record<string, unknown>) => ({ origin: "simulée", raw: raw(partial) });
const robustness = (why: string, partial: Record<string, unknown>) => ({ origin: `robustesse : ${why}`, raw: raw(partial) });
const wish = (label: string, apiField: string | null = null) => ({ label, availability: apiField ? "hybrid" : "description", apiField });

type AdFields = Omit<BenchAd, "id" | "note" | "expected">;
const visible = (id: string, note: string, fields: AdFields): BenchAd => ({ id, note, expected: "visible", ...fields });
const setAside = (id: string, note: string, fields: AdFields): BenchAd => ({ id, note, expected: "écartée", ...fields });

// Points réels (latitude, longitude).
const LILLE = { city: "Lille", zipcode: "59000" };
const P = {
  lilleGrandPlace: { lat: 50.6365, lng: 3.0635 }, wazemmes: { lat: 50.6244, lng: 3.049 }, vieuxLille: { lat: 50.642, lng: 3.063 },
  fives: { lat: 50.635, lng: 3.089 }, moulins: { lat: 50.619, lng: 3.071 }, lambersart: { lat: 50.6538, lng: 3.0248 },
  loos: { lat: 50.613, lng: 3.013 }, wattignies: { lat: 50.586, lng: 3.043 }, roubaix: { lat: 50.6887, lng: 3.1843 },
  vdaPontDeBois: { lat: 50.63, lng: 3.15 }, vdaHotelDeVille: { lat: 50.6362, lng: 3.1619 }, vdaFlers: { lat: 50.643, lng: 3.13 },
  vdaAnnappes: { lat: 50.642, lng: 3.153 }, vdaAscq: { lat: 50.63, lng: 3.185 },
  paris11: { lat: 48.859, lng: 2.38 }, paris16Auteuil: { lat: 48.8478, lng: 2.26 }, paris15Versailles: { lat: 48.8322, lng: 2.2876 },
  montreuil: { lat: 48.8638, lng: 2.4485 }, paris12BelAir: { lat: 48.84, lng: 2.4 }, vincennes: { lat: 48.8471, lng: 2.4383 },
  marseilleCastellane: { lat: 43.286, lng: 5.384 }, marseillePointeRouge: { lat: 43.241, lng: 5.372 },
  marseilleChateauGombert: { lat: 43.356, lng: 5.443 }, marseilleValentine: { lat: 43.297, lng: 5.487 }, marseilleEstaque: { lat: 43.363, lng: 5.316 },
  lyon7JeanMace: { lat: 45.745, lng: 4.842 }, saintDenis93: { lat: 48.9362, lng: 2.3574 }, aixEnProvence: { lat: 43.5297, lng: 5.4474 },
  bailleul: { lat: 50.739, lng: 2.735 }, strasbourg: { lat: 48.58, lng: 7.75 },
};

const T2_DESC = "Appartement de type 2 comprenant une entrée, un séjour avec cuisine équipée, une chambre, une salle d'eau et un WC séparé. Chauffage individuel gaz. Libre de suite.";
const T3_DESC = "Appartement de type 3 : séjour lumineux, cuisine équipée, deux chambres, salle de bains, WC séparé. Double vitrage, chauffage individuel électrique. Disponible rapidement.";

export const CASES: BenchCase[] = [
  // ───────────────────────────── Profondeur de lecture ─────────────────────────────
  {
    id: "profondeur-lille-t2", theme: "Profondeur de lecture", title: "Annonce vieille de 1 à 6 jours",
    prompt: "Je cherche un T2 à Lille, 750 € maximum.",
    why: "Le retour typique : « l'annonce était sur Le Bon Coin, l'appli ne l'a pas montrée ». La recherche ponctuelle ne lit que les 15 annonces les plus récentes ; à Lille, c'est quelques heures de publications.",
    llm: simulated({ location: "Lille", maxPrice: 750, minRooms: 2, maxRooms: 2, keywords: "T2" }),
    expect: { location: "Lille", resolved: true, maxPrice: 750, minRooms: 2, maxRooms: 2, searchText: null },
    ads: [
      visible("du-jour", "publiée ce matin, rang 3", { title: "Appartement T2 Wazemmes", description: T2_DESC, price: 690, area: 42, rooms: 2, ...LILLE, ...P.wazemmes, rank: 3, ageDays: 0.2 }),
      visible("d-hier", "publiée hier, rang 22", { title: "T2 rénové Vieux-Lille", description: T2_DESC, price: 740, area: 38, rooms: 2, ...LILLE, ...P.vieuxLille, rank: 22, ageDays: 1 }),
      visible("trois-jours", "publiée il y a 3 jours, rang 58", { title: "Bel appartement 2 pièces Fives", description: T2_DESC, price: 650, area: 45, rooms: 2, ...LILLE, ...P.fives, rank: 58, ageDays: 3 }),
      visible("six-jours", "publiée il y a 6 jours, rang 140, toujours en ligne", { title: "T2 avec cave Moulins", description: T2_DESC, price: 700, area: 40, rooms: 2, ...LILLE, ...P.moulins, rank: 140, ageDays: 6 }),
    ],
  },

  // ───────────────────────────── Géographie ─────────────────────────────
  {
    id: "paris-rayon", theme: "Géographie", title: "Paris : 5 km autour du centre ne couvrent pas Paris",
    prompt: "Appartement 2 pièces à Paris, 1 500 € maximum.",
    why: "Le rayon par défaut (5 km) part du centre de la commune. Paris fait ~11 km d'est en ouest : le 15e et le 16e sortent du cercle.",
    llm: simulated({ location: "Paris", maxPrice: 1500, minRooms: 2, maxRooms: 2, propertyType: "apartment", keywords: "appartement 2 pièces" }),
    expect: { location: "Paris", resolved: true, propertyType: "apartment", maxPrice: 1500, minRooms: 2, maxRooms: 2 },
    ads: [
      visible("paris-11", "Paris 11e, 2,5 km du centre", { title: "2 pièces Oberkampf", description: T2_DESC, price: 1390, area: 36, rooms: 2, city: "Paris", zipcode: "75011", ...P.paris11 }),
      visible("paris-16", "Paris 16e (Auteuil), 6,4 km du centre", { title: "2 pièces Auteuil", description: T2_DESC, price: 1450, area: 40, rooms: 2, city: "Paris", zipcode: "75016", ...P.paris16Auteuil }),
      visible("paris-15", "Paris 15e (porte de Versailles), 5,2 km du centre", { title: "Appartement 2 pièces Convention", description: T2_DESC, price: 1350, area: 35, rooms: 2, city: "Paris", zipcode: "75015", ...P.paris15Versailles }),
      setAside("montreuil", "Montreuil : pas Paris", { title: "2 pièces Croix de Chavaux", description: T2_DESC, price: 1100, area: 42, rooms: 2, city: "Montreuil", zipcode: "93100", ...P.montreuil }),
    ],
  },
  {
    id: "marseille-rayon", theme: "Géographie", title: "Marseille : la moitié de la ville hors du cercle",
    prompt: "Je cherche un T3 à Marseille pour 1 100 € maximum.",
    why: "Marseille s'étend sur ~20 km : 5 km autour du centre ignorent les 11e, 13e, 15e et 16e arrondissements.",
    llm: simulated({ location: "Marseille", maxPrice: 1100, minRooms: 3, maxRooms: 3, keywords: "T3" }),
    expect: { location: "Marseille", resolved: true, maxPrice: 1100, minRooms: 3, maxRooms: 3 },
    ads: [
      visible("castellane", "6e, 0,7 km", { title: "T3 Castellane", description: T3_DESC, price: 1050, area: 62, rooms: 3, city: "Marseille", zipcode: "13006", ...P.marseilleCastellane }),
      visible("pointe-rouge", "8e, 4,4 km", { title: "T3 Pointe-Rouge vue mer", description: T3_DESC, price: 1090, area: 65, rooms: 3, city: "Marseille", zipcode: "13008", ...P.marseillePointeRouge }),
      visible("chateau-gombert", "13e, 9,8 km", { title: "T3 Château-Gombert", description: T3_DESC, price: 950, area: 68, rooms: 3, city: "Marseille", zipcode: "13013", ...P.marseilleChateauGombert }),
      visible("la-valentine", "11e, 8,8 km", { title: "T3 La Valentine avec parking", description: T3_DESC, price: 980, area: 70, rooms: 3, city: "Marseille", zipcode: "13011", ...P.marseilleValentine }),
      visible("estaque", "16e, 10,6 km", { title: "T3 L'Estaque", description: T3_DESC, price: 900, area: 60, rooms: 3, city: "Marseille", zipcode: "13016", ...P.marseilleEstaque }),
    ],
  },
  {
    id: "lyon-arrondissement", theme: "Géographie", title: "Arrondissement : « Lyon 7e » n'est pas une commune",
    prompt: "T2 meublé à Lyon 7e, 900 € maximum.",
    why: "Le 29/09, gpt-5-mini a rendu « Lyon 7e » tel quel. La base des communes ne le connaît pas : repli sur l'acteur « par nom », sans type, sans pièces, sans surface ni pages.",
    llm: simulated({ location: "Lyon 7e", maxPrice: 900, minRooms: 2, maxRooms: 2, keywords: "T2 meublé", uncertainChecks: [wish("meublé", "furnished")] }),
    expect: { resolved: true, maxPrice: 900, minRooms: 2, maxRooms: 2, wishes: ["meubl"] },
    ads: [
      visible("jean-mace", "Lyon 7e, Jean Macé", { title: "T2 meublé Jean Macé", description: `${T2_DESC} Logement meublé.`, price: 850, area: 40, rooms: 2, city: "Lyon", zipcode: "69007", ...P.lyon7JeanMace, attributes: { furnished: "Meublé" } }),
    ],
  },
  {
    id: "paris12-ou-vincennes", theme: "Géographie", title: "Deux lieux en une seule chaîne",
    prompt: "Paris 12e ou Vincennes : appartement à louer, 1 500 € maximum, 45 m² minimum, deux chambres, proche d'un parc.",
    why: "Relevé du 29/09 : « Paris 12e, Vincennes » en un seul lieu, inconnu de la base → acteur de secours, zone imprévisible.",
    llm: simulated({ location: "Paris 12e, Vincennes", maxPrice: 1500, minArea: 45, minBedrooms: 2, propertyType: "apartment", keywords: "appartement", uncertainChecks: [wish("proche d'un parc")] }),
    expect: { resolved: true, maxPrice: 1500, minArea: 45, minBedrooms: 2, minRooms: null },
    ads: [
      visible("vincennes", "Vincennes", { title: "3 pièces Vincennes centre", description: "Appartement de 3 pièces avec deux chambres, proche du bois de Vincennes.", price: 1480, area: 55, rooms: 3, bedrooms: 2, city: "Vincennes", zipcode: "94300", ...P.vincennes }),
      visible("bel-air", "Paris 12e", { title: "3 pièces Bel-Air", description: "Appartement 3 pièces, deux chambres, à deux pas de la coulée verte.", price: 1490, area: 52, rooms: 3, bedrooms: 2, city: "Paris", zipcode: "75012", ...P.paris12BelAir }),
    ],
  },
  {
    id: "lille-ou-villeneuve", theme: "Géographie", title: "« Lille ou Villeneuve-d'Ascq » : une seule ville gardée",
    prompt: "T3 à Lille ou Villeneuve-d'Ascq, 1 000 € maximum.",
    why: "Une seule ville par recherche : le LLM garde Lille, les annonces de Villeneuve-d'Ascq (7 à 8 km) sortent du rayon de 5 km.",
    llm: simulated({ location: "Lille", maxPrice: 1000, minRooms: 3, maxRooms: 3, keywords: "T3" }),
    expect: { location: "Lille", resolved: true, maxPrice: 1000, minRooms: 3, maxRooms: 3 },
    ads: [
      visible("fives", "Lille Fives", { title: "T3 Fives", description: T3_DESC, price: 920, area: 64, rooms: 3, ...LILLE, ...P.fives }),
      visible("pont-de-bois", "Villeneuve-d'Ascq, Pont de Bois (7,4 km)", { title: "T3 Pont de Bois", description: T3_DESC, price: 890, area: 66, rooms: 3, city: "Villeneuve-d'Ascq", zipcode: "59650", ...P.vdaPontDeBois }),
      visible("vda-centre", "Villeneuve-d'Ascq, hôtel de ville (8,1 km)", { title: "T3 Hôtel de ville", description: T3_DESC, price: 950, area: 70, rooms: 3, city: "Villeneuve-d'Ascq", zipcode: "59650", ...P.vdaHotelDeVille }),
    ],
  },
  {
    id: "departement-nord", theme: "Géographie", title: "Un département",
    prompt: "Maison avec jardin dans le Nord, 1 100 € maximum.",
    why: "Un département n'est pas dans la base des communes : acteur de secours, recherche « Nord » par nom, rayon de 5 km.",
    llm: simulated({ location: "Nord", maxPrice: 1100, propertyType: "house", keywords: "maison jardin", uncertainChecks: [wish("jardin")] }),
    expect: { resolved: true, propertyType: "house", maxPrice: 1100 },
    ads: [
      visible("bailleul", "Bailleul (Nord)", { title: "Maison 4 pièces avec jardin", description: "Maison semi-individuelle avec jardin clos, 3 chambres.", price: 950, area: 90, rooms: 4, realEstateType: "1", city: "Bailleul", zipcode: "59270", ...P.bailleul }),
    ],
  },
  {
    id: "saint-denis-ambigu", theme: "Géographie", title: "Nom de commune ambigu",
    prompt: "Studio à Saint-Denis, 700 € maximum.",
    why: "Quatre communes s'appellent Saint-Denis : sans département, la ville n'est pas reconnue (acteur de secours).",
    llm: simulated({ location: "Saint-Denis", maxPrice: 700, minRooms: 1, maxRooms: 1, propertyType: "apartment", keywords: "studio" }),
    expect: { resolved: true, maxPrice: 700 },
    ads: [
      visible("saint-denis-93", "Saint-Denis (93)", { title: "Studio proche Basilique", description: "Studio de 22 m² avec kitchenette.", price: 650, area: 22, rooms: 1, city: "Saint-Denis", zipcode: "93200", ...P.saintDenis93 }),
    ],
  },
  {
    id: "aix-abrege", theme: "Géographie", title: "« Aix » : un village de Corrèze",
    prompt: "Studio à Aix pour mes études, 650 € maximum.",
    why: "Si le LLM recopie « Aix », la base des communes le reconnaît… comme Aix (Corrèze, 352 habitants) : la recherche part à 400 km.",
    llm: robustness("le LLM recopie « Aix »", { location: "Aix", maxPrice: 650, minRooms: 1, maxRooms: 1, propertyType: "apartment", keywords: "studio" }),
    expect: { location: "Aix-en-Provence", maxPrice: 650 },
    ads: [
      visible("aix-en-provence", "Aix-en-Provence centre", { title: "Studio centre-ville", description: "Studio meublé de 20 m², proche des facultés.", price: 600, area: 20, rooms: 1, city: "Aix-en-Provence", zipcode: "13100", ...P.aixEnProvence }),
    ],
  },
  {
    id: "lille-france", theme: "Géographie", title: "Lieu rendu « Lille, France »",
    prompt: "Appartement à Lille, 800 € maximum.",
    why: "Une ville suivie de « , France » ou de la région n'est pas reconnue (seuls un département ou un code postal le sont) : acteur de secours.",
    llm: robustness("le LLM ajoute « , France »", { location: "Lille, France", maxPrice: 800, propertyType: "apartment", keywords: "appartement" }),
    expect: { location: "Lille", resolved: true },
    ads: [
      visible("centre", "Lille centre", { title: "T2 Grand Place", description: T2_DESC, price: 780, area: 40, rooms: 2, ...LILLE, ...P.lilleGrandPlace }),
    ],
  },
  {
    id: "lille-alentours", theme: "Géographie", title: "Rayon explicite (15 km)",
    prompt: "T2 à Lille ou alentours, 15 km maximum, 750 €.",
    why: "Témoin : un rayon explicite est bien transmis.",
    llm: simulated({ location: "Lille", radius: 15, maxPrice: 750, minRooms: 2, maxRooms: 2, keywords: "T2" }),
    expect: { location: "Lille", resolved: true, radiusAtLeast: 15 },
    ads: [
      visible("roubaix", "Roubaix, 11 km", { title: "T2 Roubaix centre", description: T2_DESC, price: 600, area: 45, rooms: 2, city: "Roubaix", zipcode: "59100", ...P.roubaix }),
      visible("lambersart", "Lambersart, 2,7 km", { title: "T2 Lambersart", description: T2_DESC, price: 720, area: 44, rooms: 2, city: "Lambersart", zipcode: "59130", ...P.lambersart }),
    ],
  },
  {
    id: "lieu-de-travail", theme: "Géographie", title: "« À 20 min à vélo du CHU » : zone sans marge",
    prompt: "Je travaille à l'hôpital Huriez (CHU de Lille), je cherche un T2 à 20 minutes à vélo maximum, 800 €.",
    why: "Depuis le 06/10 (develop), la recherche se centre sur le lieu cité : bien. Mais le cercle lu chez Le Bon Coin est la portée estimée sans marge (20 min à 15 km/h, détour 1,3 → 3,85 km), alors qu'à la lecture l'app classe « à vérifier » jusqu'à 25 min : une annonce à 4,7 km (≈ 24 min) n'est jamais lue.",
    llm: simulated({ location: "Lille", maxPrice: 800, minRooms: 2, maxRooms: 2, keywords: "T2",
      places: [{ label: "Travail", kind: "work", address: "Hôpital Claude Huriez, CHU de Lille", mode: "bike", maxMinutes: 20, maxKm: null, centered: true }] }),
    geocoding: [{ match: "Huriez", lat: 50.61, lng: 3.035, city: "Lille", depcode: "59" }],
    expect: { location: "Lille", resolved: true, maxPrice: 800 },
    ads: [
      visible("loos", "Loos, 1,6 km du CHU", { title: "T2 Loos", description: T2_DESC, price: 650, area: 42, rooms: 2, city: "Loos", zipcode: "59120", ...P.loos }),
      visible("wattignies", "Wattignies, 2,7 km du CHU (5,0 km du centre de Lille)", { title: "T2 Wattignies avec parking", description: T2_DESC, price: 680, area: 48, rooms: 2, city: "Wattignies", zipcode: "59139", ...P.wattignies }),
      visible("fives", "Fives, 4,7 km du CHU : ≈ 24 min estimées, « à vérifier » pour l'app", { title: "T2 Fives", description: T2_DESC, price: 700, area: 44, rooms: 2, ...LILLE, ...P.fives }),
      setAside("pont-de-bois", "Villeneuve-d'Ascq, 8 km du CHU : trop loin", { title: "T2 Pont de Bois", description: T2_DESC, price: 650, area: 45, rooms: 2, city: "Villeneuve-d'Ascq", zipcode: "59650", ...P.vdaPontDeBois }),
    ],
  },

  // ───────────────────────────── Budget et surface ─────────────────────────────
  {
    id: "budget-environ", theme: "Budget et surface", title: "« Autour de 800 € » devient un plafond strict",
    prompt: "Un T2 à Lille autour de 800 € par mois.",
    why: "« Autour de » n'est pas « au plus » : une annonce à 830 € intéresse, le filtre du site l'écarte.",
    llm: simulated({ location: "Lille", maxPrice: 800, minRooms: 2, maxRooms: 2, keywords: "T2" }),
    expect: { location: "Lille", minRooms: 2, maxRooms: 2 },
    ads: [
      visible("790", "790 €", { title: "T2 Wazemmes", description: T2_DESC, price: 790, area: 42, rooms: 2, ...LILLE, ...P.wazemmes }),
      visible("830", "830 € : léger dépassement", { title: "T2 Vieux-Lille", description: T2_DESC, price: 830, area: 45, rooms: 2, ...LILLE, ...P.vieuxLille }),
      setAside("1000", "1 000 € : trop cher", { title: "T2 standing", description: T2_DESC, price: 1000, area: 50, rooms: 2, ...LILLE, ...P.lilleGrandPlace }),
    ],
  },
  {
    id: "hors-charges", theme: "Budget et surface", title: "« 700 € hors charges » comparé au loyer charges comprises",
    prompt: "T2 à Lille, 700 € hors charges maximum.",
    why: "Le prix Le Bon Coin est charges comprises. 690 € + 55 € de charges = 745 € : écarté alors qu'il respecte la demande.",
    llm: simulated({ location: "Lille", maxPrice: 700, minRooms: 2, maxRooms: 2, keywords: "T2" }),
    expect: { location: "Lille" },
    ads: [
      visible("690-plus-55", "690 € HC + 55 € de charges = 745 € CC", { title: "T2 Moulins", description: `${T2_DESC} Loyer 690 € hors charges + 55 € de provisions sur charges.`, price: 745, area: 43, rooms: 2, ...LILLE, ...P.moulins }),
      visible("680-cc", "680 € charges comprises", { title: "T2 Fives", description: T2_DESC, price: 680, area: 40, rooms: 2, ...LILLE, ...P.fives }),
    ],
  },
  {
    id: "surface-cinquantaine", theme: "Budget et surface", title: "« Une cinquantaine de m² » devient « 50 m² minimum »",
    prompt: "Appartement d'une cinquantaine de m² à Lille, 900 € maximum.",
    why: "Une approximation devient une borne stricte : 48 m² sont écartés.",
    llm: simulated({ location: "Lille", maxPrice: 900, minArea: 50, propertyType: "apartment", keywords: "appartement" }),
    expect: { location: "Lille", maxPrice: 900 },
    ads: [
      visible("48m2", "48 m²", { title: "T2 Wazemmes 48 m²", description: T2_DESC, price: 820, area: 48, rooms: 2, ...LILLE, ...P.wazemmes }),
      visible("52m2", "52 m²", { title: "T3 Moulins 52 m²", description: T3_DESC, price: 880, area: 52, rooms: 3, ...LILLE, ...P.moulins }),
      setAside("30m2", "30 m² : bien trop petit", { title: "Studio 30 m²", description: "Grand studio.", price: 600, area: 30, rooms: 1, ...LILLE, ...P.vieuxLille }),
    ],
  },
  {
    id: "terrain", theme: "Budget et surface", title: "Terrain de 1 000 m² (garde-fou existant)",
    prompt: "Maison à louer près de Lille avec un terrain de 1 000 m², 1 300 € maximum.",
    why: "Témoin : la surface d'un terrain prise pour la surface habitable est rattrapée (landAreaClause).",
    llm: robustness("le LLM prend le terrain pour la surface habitable", { location: "Lille", radius: 10, maxPrice: 1300, minArea: 1000, propertyType: "house", keywords: "maison terrain" }),
    expect: { location: "Lille", propertyType: "house", minArea: null, wishes: ["terrain"] },
    ads: [
      visible("lambersart", "Maison 110 m² avec terrain", { title: "Maison avec grand terrain", description: "Maison de 110 m², 4 chambres, terrain de 1 000 m² arboré.", price: 1250, area: 110, rooms: 5, realEstateType: "1", city: "Lambersart", zipcode: "59130", ...P.lambersart }),
    ],
  },
  {
    id: "budget-zero", theme: "Budget et surface", title: "Budget non fixé rendu par 0",
    prompt: "T2 à Lille, je n'ai pas encore fixé de budget.",
    why: "Si le LLM rend maxPrice = 0 au lieu de null, le code l'accepte : la recherche demande des loyers de 0 €.",
    llm: robustness("maxPrice = 0 au lieu de null", { location: "Lille", maxPrice: 0, minRooms: 2, maxRooms: 2, keywords: "T2" }),
    expect: { maxPrice: null },
    ads: [visible("t2", "T2 à 700 €", { title: "T2 Fives", description: T2_DESC, price: 700, area: 42, rooms: 2, ...LILLE, ...P.fives })],
  },
  {
    id: "rayon-zero", theme: "Budget et surface", title: "« Intra-muros » rendu par un rayon de 0",
    prompt: "Studio à Lille intra-muros, 600 € maximum.",
    why: "Un rayon de 0 devient 1 km autour du centre : la plus grande partie de Lille est perdue.",
    llm: robustness("radius = 0", { location: "Lille", radius: 0, maxPrice: 600, minRooms: 1, maxRooms: 1, propertyType: "apartment", keywords: "studio" }),
    expect: { radiusAtLeast: 3 },
    ads: [
      visible("vieux-lille", "Vieux-Lille, 1,4 km", { title: "Studio Vieux-Lille", description: "Studio de 20 m², kitchenette.", price: 560, area: 20, rooms: 1, ...LILLE, ...P.vieuxLille }),
      visible("fives", "Fives, 3 km", { title: "Studio Fives", description: "Studio de 22 m², kitchenette.", price: 520, area: 22, rooms: 1, ...LILLE, ...P.fives }),
    ],
  },

  // ───────────────────────────── Mot cherché dans le texte (text=) ─────────────────────────────
  {
    id: "balcon-ou-terrasse", theme: "Mot cherché (text=)", title: "« Balcon ou terrasse » : seul « balcon » est cherché",
    prompt: "T2 à Lille avec balcon ou terrasse, 850 € maximum.",
    why: "Le premier équipement d'un souhait devient un mot obligatoire pour Le Bon Coin (il n'y a plus de recherche élargie depuis le 01/10) : une annonce avec terrasse seulement n'est jamais lue.",
    llm: simulated({ location: "Lille", maxPrice: 850, minRooms: 2, maxRooms: 2, keywords: "T2", uncertainChecks: [wish("balcon ou terrasse")] }),
    expect: { searchText: null, wishes: ["balcon"] },
    ads: [
      visible("balcon", "avec balcon", { title: "T2 avec balcon", description: `${T2_DESC} Balcon de 5 m² exposé sud.`, price: 800, area: 45, rooms: 2, ...LILLE, ...P.wazemmes }),
      visible("terrasse", "avec terrasse seulement", { title: "T2 avec terrasse", description: `${T2_DESC} Belle terrasse de 12 m².`, price: 840, area: 47, rooms: 2, ...LILLE, ...P.vieuxLille }),
    ],
  },
  {
    id: "maison-jardin", theme: "Mot cherché (text=)", title: "« Jardin » obligatoire dans le texte",
    prompt: "Maison avec jardin à Villeneuve-d'Ascq, 1 300 € maximum.",
    why: "Une maison avec « terrain » ou « extérieur engazonné » mais sans le mot « jardin » n'est jamais lue.",
    llm: simulated({ location: "Villeneuve-d'Ascq", maxPrice: 1300, propertyType: "house", keywords: "maison jardin", uncertainChecks: [wish("jardin")] }),
    expect: { location: "Villeneuve-d'Ascq", resolved: true, propertyType: "house", searchText: null, wishes: ["jardin"] },
    ads: [
      visible("jardin", "le mot « jardin »", { title: "Maison 5 pièces avec jardin", description: "Maison de 100 m², 3 chambres, jardin clos.", price: 1250, area: 100, rooms: 5, realEstateType: "1", city: "Villeneuve-d'Ascq", zipcode: "59650", ...P.vdaFlers }),
      visible("terrain", "« terrain engazonné », pas « jardin »", { title: "Maison familiale Annappes", description: "Maison de 95 m², 3 chambres, terrain engazonné et arboré de 400 m², garage.", price: 1200, area: 95, rooms: 5, realEstateType: "1", city: "Villeneuve-d'Ascq", zipcode: "59650", ...P.vdaAnnappes }),
      setAside("appartement", "un appartement", { title: "T4 avec jardin commun", description: "Appartement T4, jardin commun à la résidence.", price: 1100, area: 85, rooms: 4, realEstateType: "2", city: "Villeneuve-d'Ascq", zipcode: "59650", ...P.vdaAscq }),
    ],
  },
  {
    id: "sans-jardin", theme: "Mot cherché (text=)", title: "« Sans jardin » cherche… « jardin »",
    prompt: "Maison à Villeneuve-d'Ascq sans jardin, je n'ai pas le temps de l'entretenir, 1 200 € maximum.",
    why: "Un souhait négatif choisit le même mot-clé : seules les annonces qui parlent de jardin sont lues, l'inverse de la demande.",
    llm: simulated({ location: "Villeneuve-d'Ascq", maxPrice: 1200, propertyType: "house", keywords: "maison", uncertainChecks: [wish("sans jardin")] }),
    expect: { searchText: null, wishes: ["sans jardin"] },
    ads: [
      visible("cour", "maison avec une petite cour", { title: "Maison de ville avec cour", description: "Maison de ville de 85 m², 3 chambres, petite cour bétonnée.", price: 1100, area: 85, rooms: 4, realEstateType: "1", city: "Villeneuve-d'Ascq", zipcode: "59650", ...P.vdaFlers }),
    ],
  },
  {
    id: "parking-garage", theme: "Mot cherché (text=)", title: "« Parking » obligatoire dans le texte",
    prompt: "T3 à Lille avec parking, 1 000 € maximum.",
    why: "Garage, box ou « place de stationnement » : pas le mot « parking », annonce jamais lue, même quand le champ Le Bon Coin dit 1 place.",
    llm: simulated({ location: "Lille", maxPrice: 1000, minRooms: 3, maxRooms: 3, keywords: "T3", uncertainChecks: [wish("parking", "parking")] }),
    expect: { searchText: null, wishes: ["parking"] },
    ads: [
      visible("parking", "« place de parking »", { title: "T3 avec place de parking", description: `${T3_DESC} Place de parking en sous-sol.`, price: 950, area: 65, rooms: 3, ...LILLE, ...P.moulins }),
      visible("garage", "« garage fermé »", { title: "T3 Lambersart avec garage", description: `${T3_DESC} Garage fermé.`, price: 980, area: 68, rooms: 3, city: "Lambersart", zipcode: "59130", ...P.lambersart }),
      visible("champ-site", "« stationnement » et champ nb_parkings = 1", { title: "T3 lumineux", description: `${T3_DESC} Une place de stationnement privative.`, price: 900, area: 62, rooms: 3, ...LILLE, ...P.fives, attributes: { nb_parkings: "1" } }),
    ],
  },
  {
    id: "studio-mot", theme: "Mot cherché (text=)", title: "« Studio » obligatoire dans le texte",
    prompt: "Studio meublé à Lille pour étudiant, 550 € maximum.",
    why: "Le type « studio » devient un mot obligatoire alors que le filtre « 1 pièce » suffit : un « T1 meublé » n'est jamais lu.",
    llm: simulated({ location: "Lille", maxPrice: 550, minRooms: 1, maxRooms: 1, propertyType: "apartment", keywords: "studio meublé", uncertainChecks: [wish("meublé", "furnished")] }),
    expect: { searchText: null, propertyType: "apartment", minRooms: 1, maxRooms: 1 },
    ads: [
      visible("studio", "« studio »", { title: "Studio meublé Vauban", description: "Studio meublé de 20 m².", price: 520, area: 20, rooms: 1, ...LILLE, ...P.lambersart }),
      visible("t1", "« T1 », pas « studio »", { title: "T1 meublé proche métro", description: "Appartement T1 meublé de 24 m², coin cuisine, salle d'eau.", price: 540, area: 24, rooms: 1, ...LILLE, ...P.moulins, attributes: { furnished: "Meublé" } }),
    ],
  },
  {
    id: "maison-chambres-mot", theme: "Mot cherché (text=)", title: "Maison 3 chambres, texte abrégé",
    prompt: "Maison 3 chambres à Lambersart, 1 400 € maximum.",
    why: "Témoin : « chambres » (au pluriel) dans les mots-clés ne devient pas un mot obligatoire ; le tri se fait sur le champ chambres du site, même quand le texte abrège « 3 ch. ».",
    llm: simulated({ location: "Lambersart", maxPrice: 1400, minBedrooms: 3, propertyType: "house", keywords: "maison 3 chambres" }),
    expect: { location: "Lambersart", resolved: true, minBedrooms: 3, minRooms: null, propertyType: "house", searchText: null },
    ads: [
      visible("3-ch", "« 3 ch. » abrégé, champ chambres = 3", { title: "Maison T5 110 m²", description: "Séjour, cuisine, 3 ch., sdb, garage.", price: 1350, area: 110, rooms: 5, bedrooms: 3, realEstateType: "1", city: "Lambersart", zipcode: "59130", ...P.lambersart }),
      setAside("2-ch", "2 chambres déclarées", { title: "Maison 2 chambres", description: "Maison de ville, 2 chambres.", price: 1100, area: 80, rooms: 4, bedrooms: 2, realEstateType: "1", city: "Lambersart", zipcode: "59130", ...P.lambersart }),
    ],
  },

  // ───────────────────────────── Filtres de lecture (sans IA) ─────────────────────────────
  {
    id: "faux-demandeurs", theme: "Filtres de lecture", title: "Offres prises pour des demandes",
    prompt: "T2 à Lille près des facs, 700 € maximum.",
    why: "« … pour un étudiant cherchant un logement » dans les 200 premiers caractères suffit à faire passer une offre pour une demande.",
    llm: simulated({ location: "Lille", maxPrice: 700, minRooms: 2, maxRooms: 2, keywords: "T2", uncertainChecks: [wish("près des facs")] }),
    expect: { location: "Lille" },
    ads: [
      visible("etudiant-cherchant", "« idéal pour un étudiant cherchant un logement »", { title: "Appartement T2 proche facultés", description: "Idéal pour un étudiant cherchant un logement proche des facultés. Séjour, cuisine équipée, une chambre.", price: 620, area: 35, rooms: 2, ...LILLE, ...P.moulins }),
      visible("personne-qui-recherche", "« parfait pour une personne qui recherche un appartement calme »", { title: "T2 lumineux", description: "Parfait pour une personne qui recherche un appartement calme. Une chambre, séjour, cuisine.", price: 650, area: 38, rooms: 2, ...LILLE, ...P.wazemmes }),
      visible("proprio-cherche", "« nous recherchons un locataire sérieux »", { title: "Logement T2", description: "Nous recherchons un locataire sérieux. Appartement calme, une chambre.", price: 600, area: 36, rooms: 2, ...LILLE, ...P.fives }),
      setAside("vraie-demande", "vraie demande de logement", { title: "Recherche T2 à Lille", description: "Couple sérieux cherche un T2 à Lille, budget 700 €.", price: 700, area: 40, rooms: 2, ...LILLE, ...P.lilleGrandPlace }),
    ],
  },
  {
    id: "fausses-colocations", theme: "Filtres de lecture", title: "Logements entiers pris pour des colocations",
    prompt: "T3 à Lille, 1 000 € maximum.",
    why: "Le filtre sans IA écarte toute mention de colocation sauf quelques tournures (« colocation acceptée », « pas de colocation »).",
    llm: simulated({ location: "Lille", maxPrice: 1000, minRooms: 3, maxRooms: 3, keywords: "T3" }),
    expect: { location: "Lille" },
    ads: [
      visible("possibilite", "« possibilité de colocation »", { title: "T3 Fives", description: `${T3_DESC} Possibilité de colocation.`, price: 900, area: 62, rooms: 3, ...LILLE, ...P.fives }),
      visible("convient", "« convient à 2 colocataires »", { title: "Grand T3", description: `${T3_DESC} Convient à 2 colocataires.`, price: 950, area: 70, rooms: 3, ...LILLE, ...P.moulins }),
      visible("ouvert", "« ouvert à la colocation »", { title: "T3 Wazemmes", description: `${T3_DESC} Ouvert à la colocation.`, price: 880, area: 60, rooms: 3, ...LILLE, ...P.wazemmes }),
      visible("chambres-dans", "« deux chambres dans un appartement entièrement rénové »", { title: "T3 rénové", description: "Deux chambres dans un appartement entièrement rénové, séjour, cuisine équipée.", price: 990, area: 64, rooms: 3, ...LILLE, ...P.vieuxLille }),
      visible("acceptee", "« colocation acceptée » (déjà géré)", { title: "T3 Vauban", description: `${T3_DESC} Colocation acceptée.`, price: 970, area: 66, rooms: 3, ...LILLE, ...P.lambersart }),
      setAside("vraie-coloc", "une chambre en colocation", { title: "Chambre dans colocation", description: "Chambre de 12 m² dans une colocation de 3 personnes, cuisine partagée.", price: 450, area: 12, rooms: 3, ...LILLE, ...P.moulins }),
    ],
  },

  {
    id: "champs-manquants", theme: "Budget et surface", title: "Annonce sans surface ou sans nombre de pièces",
    prompt: "T2 d'au moins 40 m² à Lille, 800 € maximum.",
    why: "Les fourchettes de pièces et de surface sont envoyées au site. Une annonce qui n'a pas rempli ces champs est probablement écartée par Le Bon Coin (hypothèse à vérifier : résultat « incertain »), alors que l'app, elle, la garderait.",
    llm: simulated({ location: "Lille", maxPrice: 800, minArea: 40, minRooms: 2, maxRooms: 2, keywords: "T2" }),
    expect: { minArea: 40, minRooms: 2, maxRooms: 2 },
    ads: [
      visible("sans-surface", "surface non renseignée (45 m² dans le texte)", { title: "T2 Wazemmes", description: `${T2_DESC} Surface 45 m².`, price: 720, rooms: 2, ...LILLE, ...P.wazemmes }),
      visible("sans-pieces", "pièces non renseignées (T2 dans le titre)", { title: "T2 45 m² Fives", description: T2_DESC, price: 700, area: 45, ...LILLE, ...P.fives }),
    ],
  },

  // ───────────────────────────── Type de bien, chambres, DPE ─────────────────────────────
  {
    id: "maison-type", theme: "Type de bien, chambres, DPE", title: "Une maison (correctif du 05/10)",
    prompt: "Je cherche une maison à louer à Lille, 1 300 € maximum.",
    why: "Témoin du correctif « type de bien ».",
    llm: simulated({ location: "Lille", maxPrice: 1300, propertyType: "house", keywords: "maison" }),
    expect: { location: "Lille", propertyType: "house", searchText: null },
    ads: [
      visible("maison", "maison", { title: "Maison 4 pièces", description: "Maison de 90 m², 3 chambres.", price: 1200, area: 90, rooms: 4, realEstateType: "1", ...LILLE, ...P.fives }),
      visible("autre", "rangée en « Autre »", { title: "Maison atypique", description: "Ancien atelier transformé en maison.", price: 1250, area: 100, rooms: 4, realEstateType: "5", ...LILLE, ...P.moulins }),
      visible("maison-de-ville", "« Maison de ville » rangée en appartement", { title: "Maison de ville T4", description: "Maison de ville sur 3 niveaux.", price: 1150, area: 85, rooms: 4, realEstateType: "2", ...LILLE, ...P.wazemmes }),
      setAside("appartement", "un appartement", { title: "T4 lumineux", description: "Appartement de 85 m².", price: 1100, area: 85, rooms: 4, realEstateType: "2", ...LILLE, ...P.vieuxLille }),
    ],
  },
  {
    id: "chambres-dpe", theme: "Type de bien, chambres, DPE", title: "3 chambres et DPE D minimum (correctif du 05/10)",
    prompt: "Appartement 3 chambres à Lille, DPE D minimum, 1 400 € maximum.",
    why: "Témoin : chambres et DPE vérifiés sur les champs du site.",
    llm: simulated({ location: "Lille", maxPrice: 1400, minBedrooms: 3, minEnergyClass: "D", propertyType: "apartment", keywords: "appartement" }),
    expect: { minBedrooms: 3, minRooms: null, minEnergyClass: "D", searchText: null },
    ads: [
      visible("3ch-c", "3 chambres, DPE C", { title: "T4 Vauban", description: "Appartement de 90 m², 3 chambres.", price: 1350, area: 90, rooms: 4, bedrooms: 3, energyRate: "c", ...LILLE, ...P.lambersart }),
      visible("3ch-sans-dpe", "3 chambres, DPE non indiqué", { title: "T4 Moulins", description: "Appartement de 88 m², 3 chambres.", price: 1250, area: 88, rooms: 4, bedrooms: 3, ...LILLE, ...P.moulins }),
      setAside("2ch", "2 chambres déclarées", { title: "T4 avec bureau", description: "Appartement de 80 m², 2 chambres et un bureau.", price: 1200, area: 80, rooms: 4, bedrooms: 2, energyRate: "c", ...LILLE, ...P.fives }),
      setAside("dpe-f", "DPE F", { title: "T4 ancien", description: "Appartement de 95 m², 3 chambres.", price: 1100, area: 95, rooms: 4, bedrooms: 3, energyRate: "f", ...LILLE, ...P.wazemmes }),
    ],
  },
  {
    id: "t1-ou-t2", theme: "Type de bien, chambres, DPE", title: "T1 ou T2",
    prompt: "T1 ou T2 à Lille, 650 € maximum.",
    why: "Témoin : fourchette de pièces.",
    llm: simulated({ location: "Lille", maxPrice: 650, minRooms: 1, maxRooms: 2, keywords: "T1 T2" }),
    expect: { minRooms: 1, maxRooms: 2 },
    ads: [
      visible("t1", "T1", { title: "T1 Wazemmes", description: "Studio de 25 m².", price: 520, area: 25, rooms: 1, ...LILLE, ...P.wazemmes }),
      visible("t2", "T2", { title: "T2 Fives", description: T2_DESC, price: 640, area: 38, rooms: 2, ...LILLE, ...P.fives }),
      setAside("t3", "T3", { title: "T3 Moulins", description: T3_DESC, price: 650, area: 55, rooms: 3, ...LILLE, ...P.moulins }),
    ],
  },

  // ───────────────────────────── Interprétation ─────────────────────────────
  {
    id: "demande-chargee", theme: "Interprétation", title: "Plus de 8 souhaits : les derniers disparaissent",
    prompt: "Pour Strasbourg, je voudrais louer un appartement de 70 m² minimum pour 1 400 € au plus, avec parking, ascenseur, balcon, cave, fibre, animaux acceptés, peu de bruit, DPE C ou mieux, cuisine séparée, sans vis-à-vis et proche du tram.",
    why: "interpret() ne garde que 8 souhaits, sans prévenir : « sans vis-à-vis » et « proche du tram » sont perdus.",
    llm: simulated({ location: "Strasbourg", maxPrice: 1400, minArea: 70, minEnergyClass: "C", propertyType: "apartment", keywords: "appartement",
      uncertainChecks: ["parking", "ascenseur", "balcon", "cave", "fibre", "animaux acceptés", "peu de bruit", "cuisine séparée", "sans vis-à-vis", "proche du tram"].map(label => wish(label)) }),
    expect: { location: "Strasbourg", minEnergyClass: "C", wishes: ["parking", "ascenseur", "vis-à-vis", "tram"] },
    ads: [
      visible("t3", "T3 avec parking", { title: "T3 avec parking et ascenseur", description: "Appartement de 75 m², parking, ascenseur, balcon, cave.", price: 1350, area: 75, rooms: 3, energyRate: "c", city: "Strasbourg", zipcode: "67000", ...P.strasbourg }),
    ],
  },

  // ───────────────────────────── Analyse IA (réponses simulées) ─────────────────────────────
  {
    id: "ia-chambre", theme: "Analyse IA", title: "Une phrase sur « chaque chambre » suffit à masquer un T3",
    prompt: "T3 à Lille, 1 000 € maximum.",
    why: "La seule garde est que la citation existe dans le texte. Si l'IA se trompe en citant une vraie phrase, l'annonce est masquée sans recours (réponse d'IA simulée ici).",
    llm: simulated({ location: "Lille", maxPrice: 1000, minRooms: 3, maxRooms: 3, keywords: "T3" }),
    expect: { location: "Lille" },
    ads: [
      visible("erreur-citee", "IA : « room » en citant une vraie phrase", { title: "T3 Wazemmes", description: `${T3_DESC} Chaque chambre dispose d'un placard.`, price: 900, area: 60, rooms: 3, ...LILLE, ...P.wazemmes,
        analysis: { offer: "room", offerEvidence: "Chaque chambre dispose d'un placard." } }),
      visible("erreur-inventee", "IA : « room » avec une citation inventée (garde-fou)", { title: "T3 Fives", description: T3_DESC, price: 880, area: 58, rooms: 3, ...LILLE, ...P.fives,
        analysis: { offer: "room", offerEvidence: "Chambre dans une colocation." } }),
      setAside("vraie-chambre", "IA : chambre chez l'habitant, citation exacte", { title: "T3 Moulins", description: "Je loue une chambre dans mon T3, salle de bains partagée.", price: 450, area: 60, rooms: 3, ...LILLE, ...P.moulins,
        analysis: { offer: "room", offerEvidence: "Je loue une chambre dans mon T3, salle de bains partagée." } }),
    ],
  },
];
