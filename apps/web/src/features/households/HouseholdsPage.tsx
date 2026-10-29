import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { Household } from '../../shared/api/types';
import { Doodle } from '../../shared/ui/Doodle';
import { Button, Card, Notice } from '../../shared/ui/primitives';
import { HouseholdSwipeCard } from './HouseholdSwipeCard';

import { tr } from '../../shared/i18n';
import { localizedError } from '../../shared/i18n';
export function HouseholdsPage({
  onDeleteHousehold,
}: {
  onDeleteHousehold: (household: Household) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const households = useQuery({
    queryKey: keys.households,
    queryFn: () => api<Household[]>('/households'),
  });
  const routeNotice =
    location.state &&
    typeof location.state === 'object' &&
    'notice' in location.state &&
    typeof location.state.notice === 'string'
      ? location.state.notice
      : null;
  const routeNoticeKind =
    location.state &&
    typeof location.state === 'object' &&
    'noticeKind' in location.state &&
    location.state.noticeKind === 'error'
      ? 'error'
      : 'success';
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; name: string }>('/households', 'POST', { name }),
    onSuccess: async (entry) => {
      await queryClient.invalidateQueries({ queryKey: keys.households });
      setName('');
      void navigate(`/households/${entry.id}/home`);
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
      {routeNotice && <Notice kind={routeNoticeKind}>{routeNotice}</Notice>}
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
            <HouseholdSwipeCard
              key={entry.id}
              household={entry}
              onDelete={onDeleteHousehold}
            />
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
