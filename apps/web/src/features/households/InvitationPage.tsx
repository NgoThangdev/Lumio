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
      <summary>Technical details</summary>
      {serverMessage && (
        <small>
          <strong>Server response:</strong> {serverMessage}
        </small>
      )}
      {referenceCode && (
        <small>
          <strong>Reference code:</strong> {referenceCode}
        </small>
      )}
    </details>
  );
}

const statusMessages: Record<InvitationStatus, string> = {
  ACTIVE:
    'This invitation is available. Joining requires your explicit confirmation.',
  EXPIRED: 'This invitation has expired. Ask a household Admin for a new link.',
  REVOKED: 'This invitation was revoked. Ask a household Admin for a new link.',
  USED: 'This one-time invitation has already been used. Ask a household Admin for a new link.',
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
            message:
              'We could not load this invitation. Check the link or ask a household Admin for help.',
            serverMessage: cause instanceof Error ? cause.message : undefined,
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
          ALREADY_MEMBER:
            'This account already belongs to the household. Open your household list to continue.',
          INVITATION_EXPIRED:
            'This invitation has expired. Ask a household Admin for a new link.',
          INVITATION_REVOKED:
            'This invitation was revoked. Ask a household Admin for a new link.',
          INVITATION_USED:
            'This invitation has already been used. Ask a household Admin for a new link.',
          INVITATION_NOT_FOUND:
            'Invitation not found. Check the link or ask a household Admin for a new one.',
        };
        setAcceptError({
          guidance:
            guidance[cause.code ?? ''] ??
            'We could not accept this invitation. Check its status or ask a household Admin for help.',
          serverMessage: cause.message,
          code: cause.code ?? undefined,
        });
        if (cause.status === 410) retry();
      } else {
        setAcceptError({
          guidance: isMutationOutcomeUnknown(cause)
            ? 'The acceptance result is uncertain. Check your household list before choosing to try again.'
            : cause instanceof Error
              ? cause.message
              : 'The invitation could not be accepted.',
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
        <Link className="brand" to="/households" aria-label="Lumio households">
          <Brand />
        </Link>
      </header>
      <main className="content narrow invitation-preview-page">
        <Card>
          <p className="eyebrow">Household invitation</p>
          <h1>Join a household</h1>
          {preview.kind === 'loading' && (
            <p className="muted" role="status">
              Loading invitation…
            </p>
          )}
          {preview.kind === 'not-found' && (
            <Notice kind="error">
              <p>
                Invitation not found. Check the link or ask a household Admin
                for a new one.
              </p>
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
                Retry preview
              </Button>
            </>
          )}
          {preview.kind === 'ready' && (
            <>
              <h2>{preview.data.household.name}</h2>
              <p>{statusMessages[preview.data.status]}</p>
              <p className="muted">
                Status: {preview.data.status} · Expires{' '}
                {new Date(preview.data.expiresAt).toLocaleString()}
              </p>
              {preview.data.status === 'ACTIVE' && !user && (
                <>
                  <p>
                    Sign in or sign up to decide whether to join. This preview
                    does not accept the invitation.
                  </p>
                  <Link
                    className="secondary"
                    to="/sign-in"
                    state={{ from: returnPath }}
                  >
                    Sign in or sign up
                  </Link>
                </>
              )}
              {preview.data.status === 'ACTIVE' &&
                user &&
                !acceptedMembership && (
                  <>
                    <p>
                      Signed in as {user.email}. Choose Accept to join as a
                      Member.
                    </p>
                    <Button disabled={accepting} onClick={() => void accept()}>
                      {accepting ? 'Accepting…' : 'Accept invitation'}
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
              Invitation accepted. Opening your household…
            </Notice>
          )}
        </Card>
      </main>
    </div>
  );
}
