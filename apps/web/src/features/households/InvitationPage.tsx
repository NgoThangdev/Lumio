import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  ApiError,
  isMutationOutcomeUnknown,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  Household,
  InvitationPreview,
  InvitationStatus,
  User,
} from '../../shared/api/types';
import { Brand } from '../../shared/ui/Doodle';
import { Button, Card, Notice } from '../../shared/ui/primitives';

import { tr } from '../../shared/i18n';
import { formatDate, localizedError, localizedEnum } from '../../shared/i18n';
type PreviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: InvitationPreview }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string; serverMessage?: string; code?: string };

type InvitationFailure = {
  guidance: string;
  serverMessage?: string;
  code?: string;
};

function TechnicalDetails({
  serverMessage,
  code,
}: Pick<InvitationFailure, 'serverMessage' | 'code'>) {
  if (!serverMessage && !code) return null;
  const referenceCode = code && code !== serverMessage ? code : undefined;
  return (
    <details className="invitation-technical-details">
      <summary>{tr('households:technicalDetails')}</summary>
      {serverMessage && (
        <small>
          <strong>{tr('households:serverResponse')}</strong> {serverMessage}
        </small>
      )}
      {referenceCode && (
        <small>
          <strong>{tr('households:referenceCode')}</strong> {referenceCode}
        </small>
      )}
    </details>
  );
}

const statusMessages: Record<InvitationStatus, string> = {
  ACTIVE: tr('households:invitationAvailable'),
  EXPIRED: tr('households:invitationExpiredHelp'),
  REVOKED: tr('households:invitationRevokedHelp'),
  USED: tr('households:invitationUsedHelp'),
};

export function InvitationPage({ user }: { user: User | null }) {
  const { secret } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<PreviewState>({ kind: 'loading' });
  const [refresh, setRefresh] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<InvitationFailure | null>(
    null,
  );
  const [acceptedMembership, setAcceptedMembership] = useState(false);

  useEffect(() => {
    let active = true;
    if (!secret) return;
    void api<InvitationPreview>(`/invitations/${encodeURIComponent(secret)}`)
      .then((data) => {
        if (active) setPreview({ kind: 'ready', data });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 404)
          setPreview({ kind: 'not-found' });
        else
          setPreview({
            kind: 'error',
            message: tr('households:invitationLoadFailed'),
            serverMessage:
              cause instanceof Error ? localizedError(cause) : undefined,
            code:
              cause instanceof ApiError ? (cause.code ?? undefined) : undefined,
          });
      });
    return () => {
      active = false;
    };
  }, [secret, refresh]);

  function retry() {
    setPreview({ kind: 'loading' });
    setRefresh((value) => value + 1);
  }

  async function accept() {
    if (
      !user ||
      !secret ||
      accepting ||
      preview.kind !== 'ready' ||
      preview.data.status !== 'ACTIVE'
    )
      return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const result = await api<{
        household: { id: string; name: string };
        role: 'MEMBER';
      }>(`/invitations/${encodeURIComponent(secret)}/accept`, 'POST');
      setAcceptedMembership(true);
      queryClient.setQueryData<Household[]>(keys.households, (current) =>
        current
          ? [
              ...current.filter((entry) => entry.id !== result.household.id),
              { ...result.household, role: result.role },
            ]
          : [{ ...result.household, role: result.role }],
      );
      void navigate(`/households/${result.household.id}/home`, {
        replace: true,
      });
      void queryClient.invalidateQueries({ queryKey: keys.households });
    } catch (cause) {
      if (cause instanceof ApiError) {
        const guidance: Record<string, string> = {
          ALREADY_MEMBER: tr('households:alreadyMemberContinue'),
          INVITATION_EXPIRED: tr('households:invitationExpiredHelp'),
          INVITATION_REVOKED: tr('households:invitationRevokedHelp'),
          INVITATION_USED: tr('households:invitationUsedHelp'),
          INVITATION_NOT_FOUND: tr('households:invitationNotFoundHelp'),
        };
        setAcceptError({
          guidance:
            guidance[cause.code ?? 'UNKNOWN'] ??
            tr('households:invitationAcceptFailed'),
          serverMessage: localizedError(cause),
          code: cause.code ?? undefined,
        });
        if (cause.status === 410) retry();
      } else {
        setAcceptError({
          guidance: isMutationOutcomeUnknown(cause)
            ? tr('households:invitationAcceptUncertain')
            : cause instanceof Error
              ? localizedError(cause)
              : tr('households:invitationCouldNotAccept'),
        });
      }
    } finally {
      setAccepting(false);
    }
  }

  const returnPath = `${location.pathname}${location.search}${location.hash}`;
  return (
    <div className="shell">
      <header className="topbar">
        <Link
          className="brand"
          to="/households"
          aria-label={tr('common:lumioHouseholdsTitle')}
        >
          <Brand />
        </Link>
      </header>
      <main className="content narrow invitation-preview-page">
        <Card>
          <p className="eyebrow">{tr('households:householdInvitation')}</p>
          <h1>{tr('households:joinHousehold')}</h1>
          {preview.kind === 'loading' && (
            <p className="muted" role="status">
              {tr('households:loadingInvitation')}
            </p>
          )}
          {preview.kind === 'not-found' && (
            <Notice kind="error">
              <p>{tr('households:invitationFoundCheck')}</p>
              <TechnicalDetails serverMessage="INVITATION_NOT_FOUND" />
            </Notice>
          )}
          {preview.kind === 'error' && (
            <>
              <Notice kind="error">
                <p>{preview.message}</p>
                <TechnicalDetails
                  serverMessage={preview.serverMessage}
                  code={preview.code}
                />
              </Notice>
              <Button variant="secondary" onClick={retry}>
                {tr('households:retryPreview')}
              </Button>
            </>
          )}
          {preview.kind === 'ready' && (
            <>
              <h2>{preview.data.household.name}</h2>
              <p>{statusMessages[preview.data.status]}</p>
              <p className="muted">
                {tr('households:statusExpires', {
                  status: localizedEnum(preview.data.status),
                  date: formatDate(preview.data.expiresAt),
                })}{' '}
              </p>
              {preview.data.status === 'ACTIVE' && !user && (
                <>
                  <p>{tr('households:signSignUp2')}</p>
                  <Link
                    className="secondary"
                    to="/sign-in"
                    state={{ from: returnPath }}
                  >
                    {tr('households:signSignUp')}
                  </Link>
                </>
              )}
              {preview.data.status === 'ACTIVE' &&
                user &&
                !acceptedMembership && (
                  <>
                    <p>
                      {tr('households:signed')} {user.email}
                      {tr('households:chooseAcceptJoin')}
                    </p>
                    <Button disabled={accepting} onClick={() => void accept()}>
                      {accepting
                        ? tr('households:accepting')
                        : tr('households:acceptInvitation')}
                    </Button>
                  </>
                )}
            </>
          )}
          {acceptError && (
            <Notice kind="error">
              <p>{acceptError.guidance}</p>
              <TechnicalDetails
                serverMessage={acceptError.serverMessage}
                code={acceptError.code}
              />
            </Notice>
          )}
          {acceptedMembership && (
            <Notice kind="success">
              {tr('households:invitationAcceptedOpening')}
            </Notice>
          )}
        </Card>
      </main>
    </div>
  );
}
