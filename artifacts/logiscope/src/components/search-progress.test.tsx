import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchProgress } from '@/components/search-progress';

const state = (key: string) => {
  const step = screen.getByTestId(`stage-${key}`);
  return { current: step.getAttribute('aria-current') === 'step', text: within(step).getByText(/terminée|en cours|à venir/).textContent };
};

describe('SearchProgress', () => {
  it('étape 1 : compréhension en cours, les deux suivantes à venir (toujours visibles)', () => {
    render(<SearchProgress stage="interpreting"/>);
    expect(state('interpreting')).toEqual({ current: true, text: 'en cours' });
    expect(state('searching')).toEqual({ current: false, text: 'à venir' });
    expect(state('analyzing')).toEqual({ current: false, text: 'à venir' });
    expect(screen.getByTestId('text-current-activity')).toHaveTextContent('Nous repérons vos critères');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');
  });

  it('étape 2 : la première est terminée, la recherche est en cours', () => {
    render(<SearchProgress stage="searching"/>);
    expect(state('interpreting').text).toBe('terminée');
    expect(state('searching')).toEqual({ current: true, text: 'en cours' });
    expect(state('analyzing').text).toBe('à venir');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Chercher des annonces');
  });

  it('étape 3 : vérification en cours, les deux premières terminées', () => {
    render(<SearchProgress stage="analyzing"/>);
    expect(state('interpreting').text).toBe('terminée');
    expect(state('searching').text).toBe('terminée');
    expect(state('analyzing')).toEqual({ current: true, text: 'en cours' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
  });

  it('phase normale : indique que l’on peut quitter la page et montre un aperçu de résultats', () => {
    render(<SearchProgress stage="searching"/>);
    expect(screen.getByText(/Vous pouvez quitter cette page/)).toBeInTheDocument();
    expect(screen.getByTestId('progress-preview')).toHaveAttribute('aria-hidden', 'true');
  });

  it('une étape inconnue retombe sur la première, sans erreur', () => {
    render(<SearchProgress stage="n-importe-quoi"/>);
    expect(state('interpreting').current).toBe(true);
  });

  it('phase élargie : tout est terminé, « Recherche élargie » est en cours, la barre ne recule pas, pas d’aperçu', () => {
    render(<SearchProgress stage="searching" phase="broad"/>);
    for (const key of ['interpreting', 'searching', 'analyzing']) expect(state(key).text).toBe('terminée');
    expect(screen.getByTestId('stage-broad')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85');
    expect(screen.getByText(/premières annonces sont disponibles/)).toBeInTheDocument();
    expect(screen.queryByTestId('progress-preview')).not.toBeInTheDocument();
  });

  it('phase élargie, vérification : la barre avance un peu', () => {
    render(<SearchProgress stage="analyzing" phase="broad"/>);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '92');
  });
});
