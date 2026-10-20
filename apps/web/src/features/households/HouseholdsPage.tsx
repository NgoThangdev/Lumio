import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { Household } from '../../shared/api/types';
import { Doodle } from '../../shared/ui/Doodle';
import { Button, Card, Notice } from '../../shared/ui/primitives';

import { tr } from '../../shared/i18n';
import { localizedError } from '../../shared/i18n';
export function HouseholdsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const households = useQuery({
    queryKey: keys.households,
    queryFn: () => api<Household[]>('/households'),
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; name: string }>('/households', 'POST', { name }),
    onSuccess: async (entry) => {
      await queryClient.invalidateQueries({ queryKey: keys.households });
      setName('');
      void navigate(`/households/${entry.id}/inventory`);
    },
  });
  return (
    <div className="narrow">
      <div className="heading household-heading">
        <Doodle kind="household" />
        <p className="eyebrow">{tr('common:getStarted')}</p>
        <h1>{tr('common:chooseHousehold')}</h1>
        <p>{tr('common:eachHouseholdKeeps')}</p>
      </div>
      {households.isPending ? (
        <Card>
          <p className="muted">{tr('common:loadingHouseholds')}</p>
        </Card>
      ) : households.isError ? (
        <Notice kind="error">{localizedError(households.error)}</Notice>
      ) : households.data.length > 0 ? (
        <Card>
          <h2>{tr('common:households2')}</h2>
          {households.data.map((entry) => (
            <button
              className="row"
              key={entry.id}
              onClick={() => navigate(`/households/${entry.id}/inventory`)}
            >
              <Doodle kind="household" className="household-row-doodle" />
              <span className="item-identity">
                <strong>{entry.name}</strong>
                <small>
                  {entry.role === 'ADMIN'
                    ? tr('common:admin')
                    : tr('common:member')}
                </small>
              </span>
              <span>→</span>
            </button>
          ))}
        </Card>
      ) : (
        <Card>
          <p className="muted">{tr('households:householdsYetCreate')}</p>
        </Card>
      )}
      <Card>
        <h2>{tr('common:createHousehold')}</h2>
        {create.isError && (
          <Notice kind="error">{localizedError(create.error)}</Notice>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label>
            {tr('common:householdName')}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={tr('households:householdExample')}
              required
            />
          </label>
          <Button disabled={create.isPending}>
            {tr('common:createHousehold2')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
