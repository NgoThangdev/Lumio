import { useState, type FormEvent } from 'react';
import { tr } from '@/shared/i18n';
import { Button } from '@/shared/ui/primitives';

export type InventoryDefaultNumbers = {
  defaultLowStockThreshold: string | null;
  defaultBuyThreshold: string | null;
  defaultTargetStock: string | null;
  defaultSafetyBuffer: string | null;
  defaultExpiryReminderDays: number | null;
};

export function InventoryDefaultNumberFields({
  values,
  canEdit,
  busy,
  household,
  onSave,
}: {
  values: InventoryDefaultNumbers;
  canEdit: boolean;
  busy: boolean;
  household: boolean;
  onSave: (values: InventoryDefaultNumbers) => void;
}) {
  const [draft, setDraft] = useState({
    defaultLowStockThreshold: values.defaultLowStockThreshold ?? '',
    defaultBuyThreshold: values.defaultBuyThreshold ?? '',
    defaultTargetStock: values.defaultTargetStock ?? '',
    defaultSafetyBuffer: values.defaultSafetyBuffer ?? '',
    defaultExpiryReminderDays:
      values.defaultExpiryReminderDays?.toString() ?? '',
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      defaultLowStockThreshold: draft.defaultLowStockThreshold || null,
      defaultBuyThreshold: draft.defaultBuyThreshold || null,
      defaultTargetStock: draft.defaultTargetStock || null,
      defaultSafetyBuffer: draft.defaultSafetyBuffer || null,
      defaultExpiryReminderDays:
        draft.defaultExpiryReminderDays === ''
          ? null
          : Number(draft.defaultExpiryReminderDays),
    });
  }
  const fields = [
    ['defaultBuyThreshold', tr('common:buyThreshold'), '0', '0.000001'],
    ['defaultLowStockThreshold', tr('common:lowThreshold'), '0', '0.000001'],
    ['defaultTargetStock', tr('common:targetStock'), '0.000001', '0.000001'],
    ['defaultSafetyBuffer', tr('common:safetyBuffer'), '1', '0.01'],
    ['defaultExpiryReminderDays', tr('common:expiryReminderDays'), '0', '1'],
  ] as const;
  if (!canEdit)
    return (
      <p className="muted">
        {fields
          .map(
            ([key, label]) =>
              `${label}: ${draft[key] || tr('settings:noneSet')}`,
          )
          .join(' · ')}
      </p>
    );
  return (
    <form className="field-stack" onSubmit={submit}>
      {fields.map(([key, label, min, step]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min={min}
            max={
              key === 'defaultSafetyBuffer'
                ? '3'
                : key === 'defaultExpiryReminderDays'
                  ? '30'
                  : undefined
            }
            step={step}
            value={draft[key]}
            disabled={busy}
            required={
              household &&
              (key === 'defaultSafetyBuffer' ||
                key === 'defaultExpiryReminderDays')
            }
            onChange={(event) =>
              setDraft((current) => ({ ...current, [key]: event.target.value }))
            }
          />
        </label>
      ))}
      <Button type="submit" variant="secondary" disabled={busy}>
        {tr('settings:saveInventoryDefaults')}
      </Button>
    </form>
  );
}
