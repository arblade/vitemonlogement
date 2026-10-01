// Seules les offres de location remontent : jamais les demandes de gens qui cherchent eux-mêmes un logement.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fatihRecord } from "../../test/fatih";
import { fromFatihRecord, normalize } from "./apify";
import { isSeekerAd } from "./offer";
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
      assert.ok(read, `${name} : « ${title} » doit rester`);
    }
  }
});
