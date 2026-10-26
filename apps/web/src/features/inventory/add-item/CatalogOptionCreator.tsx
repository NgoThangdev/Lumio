import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { CatalogOption } from '@/shared/api/types';
import { Button, Notice } from '@/shared/ui/primitives';
import { localizedError, tr } from '@/shared/i18n';

export type CatalogKind = 'categories' | 'locations' | 'tags';

export function CatalogOptionCreator({
  householdId,
  kind,
  onCreated,
}: {
  householdId: string;
  kind: CatalogKind;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const singular =
    kind === 'categories'
      ? 'category'
      : kind === 'locations'
        ? 'location'
        : 'tag';
  const create = useMutation({
    mutationFn: () =>
      api<CatalogOption>(`/households/${householdId}/${kind}`, 'POST', {
        name,
      }),
    onSuccess: async (option) => {
      await queryClient.invalidateQueries({
        queryKey: keys.catalog(householdId, kind),
      });
      onCreated(option.id);
      setName('');
    },
  });

  return (
    <div className="catalog-create">
      {create.isError && (
        <Notice kind="error">{localizedError(create.error)}</Notice>
      )}
      <label>
        {tr('common:new')} {singular} {tr('common:name2')}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (name.trim() && !create.isPending) create.mutate();
            }
          }}
          maxLength={80}
          placeholder={`e.g. ${kind === 'categories' ? 'Food' : kind === 'locations' ? tr('common:pantry') : 'Everyday'}`}
        />
      </label>
      <Button
        type="button"
        variant="secondary"
        disabled={create.isPending || !name.trim()}
        onClick={() => create.mutate()}
      >
        {create.isPending ? tr('inventory:adding') : `Add ${singular}`}
      </Button>
    </div>
  );
}
