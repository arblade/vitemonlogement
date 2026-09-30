import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ArrowRight, Pencil } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/site-shell';

type PromptForm = { prompt: string };

export function SearchPromptEditor({ prompt, pending, error, onSubmit }: {
  prompt: string;
  pending: boolean;
  error: string;
  onSubmit: (prompt: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const form = useForm<PromptForm>({ defaultValues: { prompt } });
  const { reset } = form;
  useEffect(() => { reset({ prompt }); setEditing(false); }, [prompt, reset]);

  return <section aria-label="Modifier la recherche" className="mb-6 rounded-xl border border-line bg-cream p-4 md:px-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-base font-semibold">Affiner votre recherche</h2>
        {editing && <p className="mt-1 text-xs leading-relaxed text-stone">Modifiez votre demande et lancez une nouvelle recherche. Celle-ci restera dans votre historique.</p>}</div>
      {!editing && <Button type="button" data-testid="button-edit-prompt" onClick={() => setEditing(true)} className="h-10 rounded-lg bg-ink px-4 text-xs font-semibold text-lime-light hover:bg-[#27272a]"><Pencil size={14} className="mr-2"/> Modifier ma demande</Button>}
    </div>
    {editing && <Form {...form}><form onSubmit={form.handleSubmit(({ prompt: value }) => onSubmit(value.trim()))} className="mt-5 space-y-3">
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
        <Button type="submit" data-testid="button-relaunch-search" disabled={pending} className="rounded-lg bg-ink text-lime-light hover:bg-[#27272a]">{pending ? 'Lancement…' : 'Relancer avec cette demande'} <ArrowRight size={15} className="ml-2"/></Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => { reset({ prompt }); setEditing(false); }}>Annuler</Button>
      </div>
    </form></Form>}
  </section>;
}