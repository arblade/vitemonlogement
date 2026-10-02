import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { ArrowRight, Pencil } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/site-shell';

type PromptForm = { prompt: string };

/** Bouton principal de la barre d'outils des résultats : ouvre le champ de modification (voir SearchPromptEditor). */
export function EditPromptButton({ onClick }: { onClick: () => void }) {
  return <Button type="button" data-testid="button-edit-prompt" onClick={onClick} className="h-10 rounded-lg bg-brand px-4 text-xs font-semibold text-lime-light hover:bg-brand-dark"><Pencil size={14} className="mr-2"/> Modifier</Button>;
}

export function SearchPromptEditor({ prompt, pending, error, editing, setEditing, onSubmit, watching = false }: {
  prompt: string;
  /** Veille quotidienne : elle suivra la nouvelle demande (le dire avant de relancer). */
  watching?: boolean;
  pending: boolean;
  error: string;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  onSubmit: (prompt: string) => Promise<void>;
}) {
  const form = useForm<PromptForm>({ defaultValues: { prompt } });
  const { reset } = form;
  useEffect(() => { reset({ prompt }); setEditing(false); }, [prompt, reset, setEditing]);
  if (!editing) return null;

  return <section aria-label="Modifier la recherche" className="mt-4 max-w-[700px] rounded-xl border border-line bg-cream p-4 md:p-5">
    <p data-testid="text-edit-prompt-note" className="text-xs leading-relaxed text-stone">{watching
      ? 'Modifiez votre demande : votre veille quotidienne la suivra, aux mêmes heures, en repartant des annonces des 4 derniers jours. L’ancienne demande restera dans votre historique.'
      : 'Modifiez votre demande et lancez une nouvelle recherche. Celle-ci restera dans votre historique.'}</p>
    <Form {...form}><form onSubmit={form.handleSubmit(({ prompt: value }) => onSubmit(value.trim()))} className="mt-3 space-y-3">
      <FormField control={form.control} name="prompt" rules={{
        required: 'Décrivez le logement recherché.',
        validate: value => value.trim().length >= 10 || 'Décrivez votre recherche en au moins 10 caractères.',
        maxLength: { value: 1000, message: 'Limitez votre description à 1 000 caractères.' },
      }} render={({ field }) => <FormItem>
        <FormControl><Textarea {...field} data-testid="input-edit-prompt" aria-label="Votre demande modifiée" rows={4} className="min-h-28 resize-y border-line bg-white text-sm"/></FormControl>
        <FormMessage/>
      </FormItem>}/>
      {error && <ErrorNotice message={error}/>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" data-testid="button-relaunch-search" disabled={pending} className="rounded-lg bg-brand text-lime-light hover:bg-brand-dark">{pending ? 'Lancement…' : 'Relancer avec cette demande'} <ArrowRight size={15} className="ml-2"/></Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => { reset({ prompt }); setEditing(false); }}>Annuler</Button>
      </div>
    </form></Form>
  </section>;
}