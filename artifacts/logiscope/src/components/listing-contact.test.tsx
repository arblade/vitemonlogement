import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { contactMessage, ListingContact } from '@/components/listing-contact';
import { listing } from '@/test/fixtures';

const unknown = (label: string) => ({ id: label, label, status: 'unknown' as const, source: 'unknown' as const, value: '', evidence: '' });
const confirmed = (label: string) => ({ ...unknown(label), status: 'confirmed' as const });

describe('contactMessage', () => {
  it('cite l’annonce, sa ville, demande la disponibilité et propose une visite', () => {
    const message = contactMessage({ title: 'Studio lumineux', location: 'Lille' }, []);
    expect(message).toContain('« Studio lumineux » à Lille');
    expect(message).toContain('toujours disponible');
    expect(message).toContain('organiser une visite');
  });

  it('pose une question par critère « non précisé » seulement, sans section si tout est connu', () => {
    const asked = contactMessage({ title: 'T', location: null }, [unknown('chat accepté'), confirmed('balcon'), unknown('ascenseur')]);
    expect(asked).toContain('- chat accepté ?');
    expect(asked).toContain('- ascenseur ?');
    expect(asked).not.toContain('balcon');
    expect(contactMessage({ title: 'T', location: null }, [confirmed('balcon')])).not.toContain('Pourriez-vous me préciser');
  });

  it('limite à 5 questions et n’invente pas de ville absente', () => {
    const many = Array.from({ length: 8 }, (_, i) => unknown(`critère ${i}`));
    const message = contactMessage({ title: 'T', location: null }, many);
    expect(message.match(/^- /gm)).toHaveLength(5);
    expect(message).not.toContain(' à null');
  });
});

describe('ListingContact', () => {
  const item = listing(1);
  const setup = () => render(<ListingContact listing={item} results={item.criterionResults}/>);

  it('affiche une ligne « Contacter le vendeur » avec un lien vers la messagerie du site source', () => {
    setup();
    expect(screen.getByText('Contacter le vendeur')).toBeInTheDocument();
    expect(screen.getByText('via leboncoin.fr')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /écrire/i });
    expect(link).toHaveAttribute('href', item.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('ne montre pas le message par défaut ; « Proposer un message » le déplie puis le replie', async () => {
    const user = userEvent.setup();
    setup();
    const toggle = screen.getByRole('button', { name: /proposer un message/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox')).toHaveValue(contactMessage(item, item.criterionResults));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('- chat accepté ?');
    await user.click(toggle);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('copie le message tel qu’il est (modifié compris) et confirme', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    setup();
    await user.click(screen.getByRole('button', { name: /proposer un message/i }));
    const field = screen.getByRole('textbox');
    await user.clear(field);
    await user.type(field, 'Bonjour, est-ce libre ?');
    await user.click(screen.getByRole('button', { name: /copier le message/i }));
    expect(writeText).toHaveBeenCalledWith('Bonjour, est-ce libre ?');
    expect(await screen.findByRole('button', { name: /message copié/i })).toBeInTheDocument();
  });

  it('indique quand la copie est impossible au lieu d’échouer en silence', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('refusé'));
    setup();
    await user.click(screen.getByRole('button', { name: /proposer un message/i }));
    await user.click(screen.getByRole('button', { name: /copier le message/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /copie impossible/i })).toBeInTheDocument());
  });
});
