import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { Household } from '../../shared/api/types';
import { Doodle } from '../../shared/ui/Doodle';
import { Button, Card, Notice } from '../../shared/ui/primitives';

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
        <p className="eyebrow">Get started</p>
        <h1>Choose a household</h1>
        <p>Each household keeps its own items and activity.</p>
      </div>
      {households.isPending ? (
        <Card>
          <p className="muted">Loading households…</p>
        </Card>
      ) : households.isError ? (
        <Notice kind="error">{households.error.message}</Notice>
      ) : households.data.length > 0 ? (
        <Card>
          <h2>Your households</h2>
          {households.data.map((entry) => (
            <button
              className="row"
              key={entry.id}
              onClick={() => navigate(`/households/${entry.id}/inventory`)}
            >
              <Doodle kind="household" className="household-row-doodle" />
              <span className="item-identity">
                <strong>{entry.name}</strong>
                <small>{entry.role === 'ADMIN' ? 'Admin' : 'Member'}</small>
              </span>
              <span>→</span>
            </button>
          ))}
        </Card>
      ) : (
        <Card>
          <p className="muted">No households yet. Create one below.</p>
        </Card>
      )}
      <Card>
        <h2>Create a household</h2>
        {create.isError && <Notice kind="error">{create.error.message}</Notice>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label>
            Household name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Our home"
              required
            />
          </label>
          <Button disabled={create.isPending}>Create household</Button>
        </form>
      </Card>
    </div>
  );
}
