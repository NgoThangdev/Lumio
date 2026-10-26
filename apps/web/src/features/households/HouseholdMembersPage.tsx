import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useHousehold } from '@/shared/household/HouseholdContext';
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

import { tr } from '../../shared/i18n';
import { formatDate, localizedError, localizedEnum } from '../../shared/i18n';
function failureMessage(error: unknown) {
  if (error instanceof ApiError && error.code === 'LAST_ADMIN')
    return tr('households:lastAdminCannot');
  if (isMutationOutcomeUnknown(error))
    return tr('households:resultConfirmedRefresh');
  return localizedError(error);
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
      setRefreshWarning(tr('households:changeSavedRefreshFailed'));
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
      setNotice(tr('households:invitationCreatedCopy'));
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
      setCopyMessage(tr('households:inviteLinkCopied'));
    } catch {
      setCopyMessage(tr('households:inviteLinkCopyUnavailable'));
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
          : tr('households:invitationAlreadyRevoked'),
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
    return <Notice kind="error">{tr('households:onlyHouseholdAdmin4')}</Notice>;

  return (
    <div className="narrow household-members-page">
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      {refreshWarning && <Notice kind="error">{refreshWarning}</Notice>}
      <Card>
        <h2>{tr('common:members')}</h2>
        {members.isPending && (
          <p className="muted" role="status">
            {tr('households:loadingMembers')}
          </p>
        )}
        {members.isError && (
          <>
            <Notice kind="error">
              {tr('households:membersLoaded')} {localizedError(members.error)}
            </Notice>
            <Button variant="secondary" onClick={() => void members.refetch()}>
              {tr('common:retry')}
            </Button>
          </>
        )}
        {members.data?.length === 0 && (
          <p className="muted">{tr('households:membersReturnedHousehold')}</p>
        )}
        {members.data?.map((member) => (
          <div className="row household-management-row" key={member.id}>
            <span className="item-identity">
              <strong>{member.email}</strong>
              <small>
                {member.role === 'ADMIN'
                  ? tr('common:admin')
                  : tr('common:member')}
                {member.id === user.id ? tr('households:you2') : ''}
              </small>
            </span>
            {removeTargetId === member.id ? (
              <span className="household-management-actions">
                <Button
                  variant="secondary"
                  disabled={pendingId !== null}
                  onClick={() => setRemoveTargetId(null)}
                >
                  {tr('households:cancel')}
                </Button>
                <Button
                  disabled={pendingId !== null}
                  onClick={() => void removeMember(member.id)}
                >
                  {pendingId === member.id
                    ? tr('households:removing')
                    : tr('common:confirmRemoval')}
                </Button>
              </span>
            ) : (
              <Button
                variant="secondary"
                disabled={pendingId !== null}
                onClick={() => setRemoveTargetId(member.id)}
              >
                {tr('common:remove')}
              </Button>
            )}
          </div>
        ))}
      </Card>
      <Card>
        <h2>{tr('households:inviteMember')}</h2>
        <p className="muted">{tr('households:createOneTime')}</p>
        <Button
          disabled={creating || pendingId !== null}
          onClick={() => void createInvitation()}
        >
          {creating ? tr('common:creating') : tr('households:createInvitation')}
        </Button>
        {createdLink && (
          <div className="invitation-created">
            <label>
              {tr('households:newInvitationLink')}
              <input
                readOnly
                value={createdLink}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <Button variant="secondary" onClick={() => void copyLink()}>
              {tr('households:copyLink')}
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
        <h2>{tr('households:invitations')}</h2>
        <p className="muted">{tr('households:serverReportsEach')}</p>
        {invitations.isPending && (
          <p className="muted" role="status">
            {tr('households:loadingInvitations')}
          </p>
        )}
        {invitations.isError && (
          <>
            <Notice kind="error">
              {tr('households:invitationsLoaded')}{' '}
              {localizedError(invitations.error)}
            </Notice>
            <Button
              variant="secondary"
              onClick={() => void invitations.refetch()}
            >
              {tr('common:retry')}
            </Button>
          </>
        )}
        {invitations.data?.length === 0 && (
          <p className="muted">{tr('households:invitationsYet')}</p>
        )}
        {invitations.data?.map((invitation) => (
          <div className="row household-management-row" key={invitation.id}>
            <span className="item-identity">
              <strong>{localizedEnum(invitation.status)}</strong>
              <small>
                {tr('households:created')} {formatDate(invitation.createdAt)}
              </small>
              <small>
                {tr('common:expires')} {formatDate(invitation.expiresAt)}
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
                    {tr('households:cancel')}
                  </Button>
                  <Button
                    disabled={pendingId !== null}
                    onClick={() => void revokeInvitation(invitation.id)}
                  >
                    {pendingId === invitation.id
                      ? tr('households:revoking')
                      : tr('households:confirmRevoke')}
                  </Button>
                </span>
              ) : (
                <Button
                  variant="secondary"
                  disabled={pendingId !== null}
                  onClick={() => setRevokeTargetId(invitation.id)}
                >
                  {tr('common:revoke')}
                </Button>
              ))}
          </div>
        ))}
      </Card>
    </div>
  );
}
