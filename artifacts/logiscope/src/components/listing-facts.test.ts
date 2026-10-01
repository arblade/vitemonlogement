import { describe, expect, it } from 'vitest';
import { Check, Zap } from 'lucide-react';
import { featureIcon, featureText, sortFeatures } from '@/components/listing-facts';

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

describe('Ordre des caractéristiques', () => {
  it('pièces et étage, équipements, énergie, charges, puis ce qui manque', () => {
    const labels = sortFeatures([
      { label: 'Charges', value: '60 €' }, { label: 'Ascenseur', value: 'Non' }, { label: 'Classe énergie', value: 'D' },
      { label: 'Cave', value: '' }, { label: 'Étage', value: '3' }, { label: 'Chambres', value: '1 ch.' }, { label: 'Chauffage', value: 'gaz' },
    ]).map(feature => feature.label);
    expect(labels).toEqual(['Chambres', 'Étage', 'Cave', 'Chauffage', 'Classe énergie', 'Charges', 'Ascenseur']);
  });
});
