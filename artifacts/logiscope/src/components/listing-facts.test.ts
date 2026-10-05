import { describe, expect, it } from 'vitest';
import { Check, Zap } from 'lucide-react';
import type { HousingListing } from '@workspace/api-client-react';
import { cardAtouts, featureGroup, featureIcon, featureText, groupFeatures, listingFacts, sortFeatures } from '@/components/listing-facts';

const text = (label: string, value = '') => featureText({ label, value });

describe('Caractéristiques en mots simples', () => {
  it('étage, chambres, salles de bain, énergie', () => {
    expect(text('Étage', '3')).toBe('3e étage');
    expect(text('Étage', '1')).toBe('1er étage');
    expect(text('Étage', '3e sur 5')).toBe('3e étage sur 5');
    expect(text('Étage', 'RDC')).toBe('Rez-de-chaussée');
    expect(text('Chambres', '1 ch.')).toBe('1 chambre');
    expect(text('Chambres', '2 ch.')).toBe('2 chambres');
    expect(text('Salles de bain', '1')).toBe('1 salle de bain');
    expect(text('Classe énergie', 'd')).toBe('DPE D');
    expect(text('Émissions GES', 'B')).toBe('GES B');
  });
  it('oui / non : « Sans ascenseur », « Non meublé », « Balcon »', () => {
    expect(text('Ascenseur', 'Non')).toBe('Sans ascenseur');
    expect(text('Meublé', 'Non')).toBe('Non meublé');
    expect(text('Ascenseur', 'Oui')).toBe('Ascenseur');
    expect(text('Cave')).toBe('Cave');
  });
  it('valeurs libres à la suite du libellé', () => {
    expect(text('Charges', '60 €')).toBe('Charges 60 €');
    expect(text('Chauffage', 'gaz individuel')).toBe('Chauffage gaz individuel');
    expect(text('Cuisine', 'équipée')).toBe('Cuisine équipée');
  });
  it('une icône par thème, une coche par défaut', () => {
    expect(featureIcon('Classe énergie')).toBe(Zap);
    expect(featureIcon('Piscine')).toBe(Check);
  });
});

describe('Pas de mots répétés entre libellé et valeur (cas réels signalés)', () => {
  it('la valeur contient déjà le libellé : on garde la valeur', () => {
    expect(text('Étage', '18e étage')).toBe('18e étage');
    expect(text('Balcon', 'vue dégagée sur le balcon')).toBe('Vue dégagée sur le balcon');
    expect(text('Eau froide', 'eau froide collective')).toBe('Eau froide collective');
    expect(text('Chauffage', 'chauffage collectif gaz')).toBe('Chauffage collectif gaz');
    expect(text('Balcons', 'balcon filant')).toBe('Balcon filant');
  });
  it('la valeur est déjà dans le libellé : on garde le libellé', () => {
    expect(text('Chauffage collectif gaz', 'gaz')).toBe('Chauffage collectif gaz');
    expect(text('Cuisine équipée', 'équipée')).toBe('Cuisine équipée');
  });
  it('mots communs à la jonction : fusionnés', () => {
    expect(text('Chauffage collectif', 'collectif gaz')).toBe('Chauffage collectif gaz');
  });
  it('aucun mot commun : libellé puis valeur, comme avant', () => {
    expect(text('Chauffage', 'individuel électrique')).toBe('Chauffage individuel électrique');
    expect(text('Cave', 'privative')).toBe('Cave privative');
  });
});

describe('Ordre des caractéristiques', () => {
  it('pièces et étage, équipements, énergie, charges, puis ce qui manque', () => {
    const labels = sortFeatures([
      { label: 'Charges', value: '60 €' }, { label: 'Ascenseur', value: 'Non' }, { label: 'Classe énergie', value: 'D' },
      { label: 'Cave', value: '' }, { label: 'Étage', value: '3' }, { label: 'Chambres', value: '1 ch.' }, { label: 'Chauffage', value: 'gaz' },
    ]).map(feature => feature.label);
    expect(labels).toEqual(['Chambres', 'Étage', 'Cave', 'Chauffage', 'Classe énergie', 'Charges', 'Ascenseur']);
  });
});

describe('Une même caractéristique n’apparaît qu’une fois (signalé : énergie / GES en double)', () => {
  const facts = (features: { label: string; value: string; source: 'annonce' | 'ia' }[]) => listingFacts(
    { price: 1, area: 1, rooms: 1, location: 'Lille', criterionResults: [], features: features.map(feature => ({ ...feature, evidence: 'x' })) } as unknown as HousingListing, [],
  ).features.map(feature => featureText(feature));

  it('« Classe énergie » du site et « DPE » / « Diagnostic de performance énergétique » relus par l’IA : une seule ligne (celle du site)', () => {
    expect(facts([
      { label: 'Classe énergie', value: 'D', source: 'annonce' }, { label: 'Émissions GES', value: 'B', source: 'annonce' },
      { label: 'DPE', value: 'D', source: 'ia' }, { label: 'GES', value: 'B', source: 'ia' },
      { label: 'Diagnostic de performance énergétique', value: 'D', source: 'ia' }, { label: 'Émissions de gaz à effet de serre', value: 'B', source: 'ia' },
    ])).toEqual(['DPE D', 'GES B']);
  });

  it('une caractéristique contenue dans une autre plus précise disparaît', () => {
    expect(facts([
      { label: 'Chauffage', value: 'collectif gaz', source: 'annonce' }, { label: 'Chauffage collectif', value: '', source: 'ia' },
      { label: 'Cave', value: '', source: 'ia' }, { label: 'Cave', value: 'privative', source: 'ia' },
    ])).toEqual(['Chauffage collectif gaz', 'Cave privative']);
  });

  it('des caractéristiques différentes restent toutes', () => {
    expect(facts([
      { label: 'Chauffage', value: 'collectif gaz', source: 'annonce' }, { label: 'Eau chaude', value: 'collective', source: 'ia' },
      { label: 'Consommation énergétique', value: '180 kWh/m²/an', source: 'ia' }, { label: 'Charges', value: '60 €', source: 'annonce' },
    ])).toHaveLength(4);
  });
});

describe('atouts de la carte et thèmes de la fiche', () => {
  const f = (label: string, value = '') => ({ label, value });

  it('cardAtouts : seulement des atouts confirmés, du plus parlant au moins parlant ; jamais un « non » ni une caractéristique anodine', () => {
    const labels = cardAtouts([
      f('Meublé'), f('Chambres', '2 ch.'), f('Cachet'), f('Ascenseur', 'Non'), f('Lave-vaisselle'), f('Parking'), f('Terrasse'), f('Calme'),
      f('Classe énergie', 'c'), f('Vue dégagée'), f('Animaux acceptés', 'Non'), f('Dernier étage'),
    ]).map(feature => feature.label);
    expect(labels).toEqual(['Terrasse', 'Vue dégagée', 'Dernier étage', 'Parking', 'Meublé', 'Cachet', 'Calme']);
  });

  it('featureGroup : chaque caractéristique du catalogue a son thème', () => {
    const groups: Record<string, string[]> = {
      outside: ['Balcon', 'Terrasse', 'Jardin', 'Cave', 'Parking', 'Local vélo', 'Vue dégagée', 'Extérieur'],
      inside: ['Cuisine équipée', 'Lave-linge', 'Lave-vaisselle', 'Baignoire', 'WC séparés', 'Double vitrage', 'Climatisation', 'Cheminée', 'Parquet', 'Duplex', 'Rénové', 'Lumineux', 'Cachet', 'Rangements', 'Bon état', 'Chambres', 'Salles de bain'],
      building: ['Ascenseur', 'Dernier étage', 'Rez-de-chaussée', 'Étage', 'Interphone', 'Gardien'],
      area: ['Proche transports', 'Calme'],
      terms: ['Meublé', 'Charges comprises', 'Animaux acceptés', 'Colocation acceptée', 'Étudiants acceptés', 'Garantie Visale', 'APL possible', "Sans frais d'agence", 'Chauffage', 'Classe énergie', 'Emissions GES'],
    };
    for (const [group, labels] of Object.entries(groups)) for (const label of labels) expect(featureGroup(label), label).toBe(group);
    expect(featureGroup('Quelque chose')).toBe('other');
  });

  it('groupFeatures : thèmes dans l\'ordre de lecture, thèmes vides omis, absent en dernier dans son thème', () => {
    const grouped = groupFeatures([f('Ascenseur', 'Non'), f('Étage', '3'), f('Meublé'), f('Balcon'), f('Interphone')]);
    expect(grouped.map(group => [group.id, group.features.map(feature => feature.label)])).toEqual([
      ['outside', ['Balcon']], ['building', ['Étage', 'Interphone', 'Ascenseur']], ['terms', ['Meublé']],
    ]);
  });

  it('chaque atout de la carte a une icône propre (pas la coche générique)', () => {
    for (const label of ['Terrasse', 'Vue dégagée', 'Dernier étage', 'Ascenseur', 'Parking', 'Meublé', 'Cachet', 'Duplex', 'Lumineux', 'Calme']) {
      expect(featureIcon(label), label).not.toBe(featureIcon('Quelque chose'));
    }
  });
});
