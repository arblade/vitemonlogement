// Seules les offres de location remontent : jamais les demandes de gens qui cherchent eux-mêmes un logement.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fatihRecord } from "../../test/fatih";
import { fromFatihRecord, normalize } from "./apify";
import { isColocationAd, isSeekerAd } from "./offer";
import type { Criteria } from "./store";

const criteria = { location: "Lille", intent: "rent", wishes: [], checks: [], places: [] } as unknown as Criteria;
const sample = (name: string): Record<string, unknown>[] => JSON.parse(readFileSync(new URL(`../../test/${name}`, import.meta.url), "utf8"));
const seeker = (title: string, description = "Merci de me contacter.") => isSeekerAd({ title, description });

test("type d'annonce : seule une offre passe (demande ou valeur inconnue : écartée), absent : le texte décide", () => {
  assert.equal(isSeekerAd({ adType: "demand", title: "T2 Lille", description: "" }), true);
  assert.equal(isSeekerAd({ adType: "recherche", title: "T2 Lille", description: "" }), true);
  assert.equal(isSeekerAd({ adType: "offer", title: "T2 Lille", description: "" }), false);
  assert.equal(isSeekerAd({ adType: " OFFER ", title: "T2 Lille", description: "" }), false);
  assert.equal(isSeekerAd({ title: "T2 Lille", description: "" }), false);
});

test("texte : quelqu'un qui cherche un logement est écarté (titre)", () => {
  for (const title of [
    "Recherche appartement T2 Lille", "Cherche T2 meublé Lille", "Couple cherche appartement", "Jeune actif recherche studio",
    "Je cherche à louer un T2", "URGENT - étudiante cherche logement", "Nous recherchons un appartement 3 pièces", "Famille à la recherche d'une maison",
  ]) assert.equal(seeker(title), true, title);
});

test("texte : quelqu'un qui cherche un logement est écarté (début de la description)", () => {
  assert.equal(seeker("T2 Lille", "Bonjour, je recherche un appartement T2 sur Lille pour septembre, budget 700 €."), true);
  assert.equal(seeker("Lille", "Bonjour, nous sommes à la recherche d'un logement pour notre famille."), true);
});

test("texte : un propriétaire ou une agence qui propose un logement n'est jamais écarté", () => {
  for (const title of [
    "Appartement T2 à louer", "Chambre à louer, cherche étudiant sérieux", "Je cherche un locataire pour mon appartement T2",
    "Studio meublé - recherche locataire", "Recherche locataire pour T2 Vauban", "Appartement 2 pièces 45 m²", "Magnifique appt proche parc JB Lebas",
    "T2 lumineux, recherche couple sérieux pour colocation", "Chambre en colocation, cherche étudiant(e)", "Recherche personne sérieuse pour studio meublé",
  ]) assert.equal(seeker(title), false, title);
  assert.equal(seeker("Appartement à louer", "Dans un quartier recherché et vivant, ce duplex meublé se trouve dans une résidence calme."), false, "adjectif « recherché » (annonce SeLoger réelle)");
  assert.equal(seeker("Duplex Lille", "Résidence très recherchée, appartement lumineux."), false);
  assert.equal(seeker("Appartement à louer", "Recherche appartement ? Celui-ci est fait pour vous."), false, "titre « à louer » : offre");
  assert.equal(seeker("Studio Lille", "Je loue mon studio de 20 m². Je cherche un locataire sérieux pour mon appartement."), false);
  assert.equal(seeker("T2", "Appartement T2 à louer. Disponible de suite, recherche un locataire."), false);
});

test("« … à louer » après un verbe de recherche : c'est une demande, pas une offre (annonces réelles Rennes du 05/10/2026)", () => {
  // Le Bon Coin les rangeait en « offer » dans Locations ; « à louer » complète ici ce qui est cherché.
  assert.equal(seeker("Demande", "Urgent: Je recherche un bien à louer pour ma famille de 4 personnes qui vient en vacance tout le mois de décembre."), true);
  assert.equal(seeker("Recherche maison à louer – Rennes / Pacé / Betton", "Bonjour, Je recherche une maison à louer pour moi et ma mère, à Rennes ou dans les alentours, notamment à Pacé, Betton ou dans les communes proches. Nous recherchons idéalement une maison avec 2 chambres."), true);
  assert.equal(seeker("Recherche petite maison", "Couples retraités recherchent petite maison ou appartement rdc dept 35 ou 56"), true);
  for (const title of ["Recherche appartement à louer Lille", "Cherchons maison à louer sur Rennes", "Famille recherche un T3 à louer", "Je recherche studio à louer, budget 500 €"]) {
    assert.equal(seeker(title), true, title);
  }
});

test("« à louer » reste une offre quand ce qui est cherché est un locataire, quand la recherche vient après, ou dans une autre phrase", () => {
  for (const [title, description] of [
    ["Recherche locataire pour appartement T2 à louer", "Merci de me contacter."],
    ["Cherchons locataires sérieux pour belle maison à louer", "Merci de me contacter."],
    ["Cherche couple sérieux, appartement à louer", "Merci de me contacter."],
    ["Maison à louer", "Je recherche une famille calme, sans animaux."],
    ["Maison à louer", "Située à Pacé. Recherche un locataire solvable pour ce bien."],
    ["T2", "Je recherche un locataire. Appartement à louer de suite."],
    ["Appartement T3 à louer", "Cherche locataire, dossier solide demandé."],
    ["Maison 4 chambres", "Maison à louer à Rennes, proche commerces. Je cherche une famille."],
  ] as const) assert.equal(seeker(title, description), false, `${title} / ${description}`);
});

test("Le Bon Coin (fatihtahta) : une demande est écartée, une offre garde son comportement", () => {
  const ad = { url: "https://www.leboncoin.fr/ad/locations/9001", title: "Appartement T2 à Lille", description: "Beau T2 lumineux à louer.", price: 650, area: 40, rooms: 2 };
  assert.ok(normalize({ ...fatihRecord(ad), listing_type: "offer" }, criteria), "offre gardée");
  assert.equal(normalize({ ...fatihRecord(ad), listing_type: "demand" }, criteria), null, "type « demande »");
  assert.equal(normalize(fatihRecord({ ...ad, title: "Recherche appartement T2 Lille", description: "Merci de me contacter." }), criteria), null, "texte « Recherche… » sans type");
  assert.equal(fromFatihRecord({ ...fatihRecord(ad), listing_type: "offer" })?.ad_type, "offer");
});

test("Le Bon Coin (clearpath) : ad_type « demand » écarté", () => {
  const raw = { ...sample("leboncoin-clearpath-sample.json")[0] };
  assert.ok(normalize(raw, criteria), "offre gardée");
  assert.equal(normalize({ ...raw, ad_type: "demand" }, criteria), null);
  assert.equal(normalize({ ...raw, subject: "Cherche appartement 1 pièce" }, criteria), null);
});

test("annonces réelles : aucune offre n'est écartée à tort (SeLoger, PAP)", () => {
  for (const name of ["seloger-sample.json", "pap-sample.json"]) {
    for (const record of sample(name)) {
      const title = String(record.title ?? ""), description = String(record.description ?? "");
      assert.equal(isSeekerAd({ title, description }), false, `${name} : « ${title} » ${description.slice(0, 60)}`);
    }
  }
});

test("annonces réelles : aucune offre n'est écartée à tort (Le Bon Coin, deux acteurs)", () => {
  for (const name of ["leboncoin-fatih-sample.json", "leboncoin-clearpath-sample.json"]) {
    for (const record of sample(name)) {
      const read = normalize(record, criteria);
      const title = String(record.title ?? record.subject);
      if (title.startsWith("Chambre meublée à louer")) assert.equal(read, null, "la chambre seule est écartée (colocation / chambre)");
      else assert.ok(read, `${name} : « ${title} » doit rester`);
    }
  }
});

const coloc = (title: string, description = "Logement lumineux, proche métro.") => isColocationAd({ title, description });

test("colocation : titres de colocation ou de chambre seule écartés", () => {
  for (const title of [
    "Colocation 4 chambres Lille", "Chambre meublée à louer, avec WC et Douche", "Chambre en colocation, cherche étudiant(e)", "T3 en colocation",
    "Coloc étudiante Vauban", "Chambre chez l'habitant", "Chambres à louer - résidence étudiante", "2 chambres disponibles en colocation", "Location chambre meublée Lille",
  ]) assert.equal(coloc(title), true, title);
});

test("colocation : repérée dans le texte quand le titre ne dit rien (annonces PAP : titre = ville)", () => {
  assert.equal(coloc("Loos (59120)", "Chambres dans un appartement de 80m2 - Colocation 4 chambres - Rue du Maréchal Foch à Loos"), true);
  assert.equal(coloc("Loos", "Quatre chambres sont disponibles dans une colocation meublée de 4 chambres."), true);
  assert.equal(coloc("Roubaix", "Colocation dans maison d'environ 120 m², entièrement équipée."), true);
  assert.equal(coloc("Lille", "Cuisine et salon partagés avec 2 colocataires, ambiance conviviale."), true);
  assert.equal(coloc("Lille", "Belle chambre dans un appartement de 90 m², libre de suite."), true);
});

test("colocation : un logement entier n'est jamais écarté, même si la colocation y est permise ou le mot « chambre » présent", () => {
  for (const [title, description] of [
    ["Appartement 2 chambres", "Séjour, cuisine équipée, 2 chambres, salle de bain."],
    ["T2 Lille Fives", "Appartement meublé avec 1 chambre en mezzanine et cuisine équipée ouverte."],
    ["T3 Vauban", "Colocation acceptée. Loyer 900 €, charges comprises."],
    ["T3 Vauban", "Colocation autorisée, bail solidaire possible."],
    ["T4 Lille", "Idéal pour une colocation : 3 chambres, 2 salles d'eau."],
    ["T4 Lille", "Appartement parfait pour colocation, proche des écoles."],
    ["Studio Lille", "Pas de colocation. Fumeurs non acceptés."],
    ["Studio Lille", "Colocation non autorisée."],
    ["Appartement 1 pièce", "Parties communes de l'immeuble entretenues, local vélos."],
    ["Appartement t2", "Cet appartement comprend 1 chambre, une cuisine équipée et un séjour."],
  ]) assert.equal(coloc(title, description), false, `${title} | ${description}`);
});

test("colocations : annonces réelles — les chambres et colocations sont écartées, les logements entiers restent", () => {
  const expected: Record<string, number> = { "leboncoin-fatih-sample.json": 1, "leboncoin-clearpath-sample.json": 1, "seloger-sample.json": 4, "pap-sample.json": 2 };
  for (const [name, count] of Object.entries(expected)) {
    const dropped = sample(name).filter(record => isColocationAd({ title: String(record.title ?? record.subject ?? ""), description: String(record.description ?? record.body ?? "") }));
    assert.equal(dropped.length, count, `${name} : ${dropped.map(record => record.title ?? record.subject).join(" ; ")}`);
  }
});

test("colocation : écartée aussi à l'entrée du pipeline (Le Bon Coin, SeLoger, PAP), sans appeler l'IA", () => {
  const ad = { url: "https://www.leboncoin.fr/ad/locations/9002", title: "Chambre meublée à louer", description: "Je loue cette chambre de 12 m².", price: 400, area: 12, rooms: 1 };
  assert.equal(normalize(fatihRecord(ad), criteria), null, "chambre Le Bon Coin");
  assert.equal(normalize(fatihRecord({ ...ad, title: "T2 Lille", description: "Colocation 3 chambres dans un grand appartement." }), criteria), null, "colocation dans la description");
  assert.ok(normalize(fatihRecord({ ...ad, title: "T2 Lille", description: "T2 lumineux de 40 m². Colocation acceptée." }), criteria), "logement entier, colocation permise : gardé");
});
