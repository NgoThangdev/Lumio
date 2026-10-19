import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useHousehold } from '../../app/useHousehold';
import {
  api,
  ApiError,
  isMutationOutcomeUnknown,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  HouseholdInvitation,
  HouseholdMember,
  User,
} from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';

function failureMessage(error: unknown) {
  if (error instanceof ApiError && error.code === 'LAST_ADMIN')
    return 'The last Admin cannot be removed (LAST_ADMIN).';
  if (isMutationOutcomeUnknown(error))
    return 'The result could not be confirmed. Refresh the server list before choosing to try again.';
  return error instanceof Error
    ? error.message
    : 'The request could not be completed.';
}

export function HouseholdMembersPage({ user }: { user: User }) {
  const household = useHousehold();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const base = `/households/${household.id}`;
  const isAdmin = household.role === 'ADMIN';
  const members = useQuery({
    queryKey: keys.members(household.id),
    queryFn: () => api<HouseholdMember[]>(`${base}/members`),
    enabled: isAdmin,
  });
  const invitations = useQuery({
    queryKey: keys.invitations(household.id),
    queryFn: () => api<HouseholdInvitation[]>(`${base}/invitations`),
    enabled: isAdmin,
  });
  const [creating, setCreating] = useState(false);
  const [createdInvitePath, setCreatedInvitePath] = useState<string | null>(
    null,
  );
  const [copyMessage, setCopyMessage] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshWarning, setRefreshWarning] = useState('');
  const createdLink = createdInvitePath
    ? new URL(createdInvitePath, window.location.origin).href
    : null;

  async function refreshList(kind: 'members' | 'invitations') {
    try {
      await queryClient.invalidateQueries(
        {
          queryKey:
            kind === 'members'
              ? keys.members(household.id)
              : keys.invitations(household.id),
          refetchType: 'active',
        },
        { throwOnError: true },
      );
      return true;
    } catch {
      setRefreshWarning(
        'The change was saved, but the server list could not refresh. Reload this page to check its current status.',
      );
      return false;
    }
  }

  async function createInvitation() {
    if (creating) return;
    setCreating(true);
    setCreatedInvitePath(null);
    setCopyMessage('');
    setError('');
    setNotice('');
    setRefreshWarning('');
    try {
      const result = await api<{
        id: string;
        invitePath: string;
        expiresAt: string;
      }>(`${base}/invitations`, 'POST');
      setCreatedInvitePath(result.invitePath);
      setNotice(
        'Invitation created. Copy this one-time link now; it will not appear in the invitation list.',
      );
      await refreshList('invitations');
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setCreating(false);
    }
  }

  async function copyLink() {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopyMessage(
        'Link copied. Share it manually with the person you want to invite.',
      );
    } catch {
      setCopyMessage(
        'Copy was unavailable. Select and copy the link above manually.',
      );
    }
  }

  async function revokeInvitation(id: string) {
    if (pendingId) return;
    setPendingId(id);
    setError('');
    setNotice('');
    setRefreshWarning('');
    try {
      const result = await api<{ revoked: boolean }>(
        `${base}/invitations/${id}`,
        'DELETE',
      );
      setRevokeTargetId(null);
      setNotice(
        result.revoked
          ? 'Invitation revoked.'
          : 'The invitation was already revoked.',
      );
      await refreshList('invitations');
    } catch (cause) {
      setError(failureMessage(cause));
      await queryClient.invalidateQueries({
        queryKey: keys.invitations(household.id),
      });
    } finally {
      setPendingId(null);
    }
  }

  async function removeMember(id: string) {
    if (pendingId) return;
    setPendingId(id);
    setError('');
    setNotice('');
    setRefreshWarning('');
    try {
      await api<{ removed: true }>(`${base}/members/${id}`, 'DELETE');
      setRemoveTargetId(null);
      setNotice('Member removed.');
      await queryClient.invalidateQueries({ queryKey: keys.households });
      if (id === user.id) {
        void navigate('/households', { replace: true });
      } else {
        await refreshList('members');
      }
    } catch (cause) {
      setError(failureMessage(cause));
      await queryClient.invalidateQueries({
        queryKey: keys.members(household.id),
      });
    } finally {
      setPendingId(null);
    }
  }

  if (!isAdmin)
    return (
      <Notice kind="error">
        Only a household Admin can manage members and invitations.
      </Notice>
    );

  return (
    <div className="narrow household-members-page">
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      {refreshWarning && <Notice kind="error">{refreshWarning}</Notice>}
      <Card>
        <h2>Members</h2>
        {members.isPending && (
          <p className="muted" role="status">
            Loading members…
          </p>
        )}
        {members.isError && (
          <>
            <Notice kind="error">
              Members could not be loaded: {members.error.message}
            </Notice>
            <Button variant="secondary" onClick={() => void members.refetch()}>
              Retry
            </Button>
          </>
        )}
        {members.data?.length === 0 && (
          <p className="muted">No members were returned for this household.</p>
        )}
        {members.data?.map((member) => (
          <div className="row household-management-row" key={member.id}>
            <span className="item-identity">
              <strong>{member.email}</strong>
              <small>
                {member.role === 'ADMIN' ? 'Admin' : 'Member'}
                {member.id === user.id ? ' · You' : ''}
              </small>
            </span>
            {removeTargetId === member.id ? (
              <span className="household-management-actions">
                <Button
                  variant="secondary"
                  disabled={pendingId !== null}
                  onClick={() => setRemoveTargetId(null)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={pendingId !== null}
                  onClick={() => void removeMember(member.id)}
                >
                  {pendingId === member.id ? 'Removing…' : 'Confirm removal'}
                </Button>
              </span>
            ) : (
              <Button
                variant="secondary"
                disabled={pendingId !== null}
                onClick={() => setRemoveTargetId(member.id)}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
      </Card>
      <Card>
        <h2>Invite a member</h2>
        <p className="muted">
          Create a one-time link, then share it yourself. The link is available
          only immediately after creation.
        </p>
        <Button
          disabled={creating || pendingId !== null}
          onClick={() => void createInvitation()}
        >
          {creating ? 'Creating…' : 'Create invitation'}
        </Button>
        {createdLink && (
          <div className="invitation-created">
            <label>
              New invitation link
              <input
                readOnly
                value={createdLink}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <Button variant="secondary" onClick={() => void copyLink()}>
              Copy link
            </Button>
            {copyMessage && (
              <p className="muted" role="status">
                {copyMessage}
              </p>
            )}
          </div>
        )}
      </Card>
      <Card>
        <h2>Invitations</h2>
        <p className="muted">
          The server reports each status. Previous invitation links cannot be
          retrieved here.
        </p>
        {invitations.isPending && (
          <p className="muted" role="status">
            Loading invitations…
          </p>
        )}
        {invitations.isError && (
          <>
            <Notice kind="error">
              Invitations could not be loaded: {invitations.error.message}
            </Notice>
            <Button
              variant="secondary"
              onClick={() => void invitations.refetch()}
            >
              Retry
            </Button>
          </>
        )}
        {invitations.data?.length === 0 && (
          <p className="muted">No invitations yet.</p>
        )}
        {invitations.data?.map((invitation) => (
          <div className="row household-management-row" key={invitation.id}>
            <span className="item-identity">
              <strong>{invitation.status}</strong>
              <small>
                Created {new Date(invitation.createdAt).toLocaleString()}
              </small>
              <small>
                Expires {new Date(invitation.expiresAt).toLocaleString()}
              </small>
            </span>
            {invitation.status === 'ACTIVE' &&
              (revokeTargetId === invitation.id ? (
                <span className="household-management-actions">
                  <Button
                    variant="secondary"
                    disabled={pendingId !== null}
                    onClick={() => setRevokeTargetId(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={pendingId !== null}
                    onClick={() => void revokeInvitation(invitation.id)}
                  >
                    {pendingId === invitation.id
                      ? 'Revoking…'
                      : 'Confirm revoke'}
                  </Button>
                </span>
              ) : (
                <Button
                  variant="secondary"
                  disabled={pendingId !== null}
                  onClick={() => setRevokeTargetId(invitation.id)}
                >
                  Revoke
                </Button>
              ))}
          </div>
        ))}
      </Card>
    </div>
  );
}
