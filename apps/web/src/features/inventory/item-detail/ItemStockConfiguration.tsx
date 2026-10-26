import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { Config, Item } from '@/shared/api/types';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import { localizedError, tr } from '@/shared/i18n';

export function OpeningConfigForm({
  householdId,
  item,
  onSaved,
}: {
  householdId: string;
  item: Item;
  onSaved: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(item.openedTrackingEnabled ?? false);
  const [days, setDays] = useState(
    item.recommendedDaysAfterOpening?.toString() ?? '',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/households/${householdId}/items/${item.id}/opening-config`, 'PUT', {
        enabled,
        recommendedDaysAfterOpening: days ? Number(days) : null,
        ...(enabled ? { packageCountConfirmed: true } : {}),
      }),
    onSuccess: async () => {
      await onSaved();
      setConfirmed(false);
      setNotice(
        enabled
          ? tr('item-detail:openingTrackingEnabled')
          : tr('item-detail:openingTrackingDisabled'),
      );
    },
  });
  return (
    <Card>
      <details>
        <summary className="settings-summary">
          {tr('common:openingPolicy')}
        </summary>
        <p className="muted">{tr('item-detail:useOnlyOne')}</p>
        {notice && <Notice kind="success">{notice}</Notice>}
        {save.isError && (
          <Notice kind="error">{localizedError(save.error)}</Notice>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (enabled && !confirmed) return;
            setNotice('');
            void save.mutateAsync().catch(() => undefined);
          }}
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setConfirmed(false);
              }}
            />{' '}
            {tr('item-detail:trackOpenedPackages')}
          </label>
          {enabled && (
            <>
              <label>
                {tr('item-detail:recommendedDaysOpening')}{' '}
                <em>{tr('common:optional2')}</em>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  required
                />{' '}
                {tr('item-detail:iConfirmOne')} {item.primaryUnit}{' '}
                {tr('item-detail:equalsOneComplete')}
              </label>
            </>
          )}
          <Button
            variant="secondary"
            className="wide"
            disabled={save.isPending || (enabled && !confirmed)}
          >
            {save.isPending
              ? tr('common:saving')
              : tr('item-detail:saveOpeningPolicy')}
          </Button>
        </form>
      </details>
    </Card>
  );
}

export function ConfigForm({
  householdId,
  item,
  onSaved,
}: {
  householdId: string;
  item: Item;
  onSaved: () => Promise<void>;
}) {
  const [config, setConfig] = useState<Config>({
    minimumStock: item.minimumStock,
    lowStockThreshold: item.lowStockThreshold,
    buyThreshold: item.buyThreshold,
    targetStock: item.targetStock,
    neverRunOut: item.neverRunOut,
    predictionEnabled: item.predictionEnabled,
  });
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/households/${householdId}/items/${item.id}/config`, 'PUT', config),
    onSuccess: onSaved,
  });
  return (
    <Card>
      <details>
        <summary className="settings-summary">
          {tr('item-detail:stockRules')}
        </summary>
        <p className="muted">
          {tr('common:optionalValuesUse')} {item.primaryUnit}
          {tr('item-detail:setTargetEnable')}
        </p>
        {notice && <Notice kind="success">{notice}</Notice>}
        {save.isError && (
          <Notice kind="error">{localizedError(save.error)}</Notice>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setNotice('');
            void save
              .mutateAsync()
              .then(() => setNotice('Stock rules saved.'))
              .catch(() => undefined);
          }}
        >
          {(
            [
              ['minimumStock', tr('common:minimumStock')],
              ['buyThreshold', tr('common:buyThreshold')],
              ['lowStockThreshold', tr('common:lowThreshold')],
              ['targetStock', tr('common:targetStock')],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                type="number"
                min="0"
                step="0.000001"
                value={config[field] ?? ''}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    [field]: event.target.value || null,
                  }))
                }
              />
            </label>
          ))}
          <label className="check-label">
            <input
              type="checkbox"
              checked={config.neverRunOut}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  neverRunOut: event.target.checked,
                }))
              }
            />{' '}
            {tr('common:neverRunOut')}
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={config.predictionEnabled}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  predictionEnabled: event.target.checked,
                }))
              }
            />{' '}
            {tr('common:predictUseHistory')}
          </label>
          <Button
            variant="secondary"
            className="wide"
            disabled={save.isPending}
          >
            {tr('common:saveStockRules')}
          </Button>
        </form>
      </details>
    </Card>
  );
}
