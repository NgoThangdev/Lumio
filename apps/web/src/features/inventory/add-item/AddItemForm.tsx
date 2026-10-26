import type { Household, TrackingMode } from '@/shared/api/types';
import {
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '@/shared/api/client';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import { localizedError, tr } from '@/shared/i18n';
import { AddItemCatalogFields } from './AddItemCatalogFields';
import { AddItemStockFields } from './AddItemStockFields';
import { useAddItemForm, type QuickPurchaseSeed } from './useAddItemForm';

export type { QuickPurchaseSeed } from './useAddItemForm';

export function AddItemForm({
  household,
  quickPurchaseSeed,
}: {
  household: Household;
  quickPurchaseSeed?: QuickPurchaseSeed;
}) {
  const form = useAddItemForm({ household, quickPurchaseSeed });
  const formGuidance =
    form.categories.isPending || form.locations.isPending
      ? tr('common:loadingHouseholdS')
      : form.categories.isError || form.locations.isError
        ? tr('inventory:categoriesLocationsLoad')
        : !form.categoryId || !form.locationId
          ? `Choose ${!form.categoryId && !form.locationId ? 'a category and a location' : !form.categoryId ? 'a category' : 'a location'} to continue. ${household.role === 'ADMIN' ? tr('inventory:ifThereOptions') : tr('inventory:askHouseholdAdmin')}`
          : tr('inventory:readyCheckDetails');

  return (
    <Card className="create-card" id="add-item">
      <p className="eyebrow">{tr('inventory:makeLittleRoom')}</p>
      <h2 id="add-item-heading">{tr('inventory:addSomethingHome')}</h2>
      <p className="muted">{tr('inventory:choosePlaceStarting')}</p>
      {form.create.isError && (
        <Notice kind="error">
          {form.create.error instanceof OfflineBeforeSendError
            ? localizedError(form.create.error)
            : isMutationOutcomeUnknown(form.create.error)
              ? `The item request outcome is unknown. It may already have been saved. Check Inventory or Item Detail activity before choosing to retry. ${localizedError(form.create.error)}`
              : `Item creation was rejected. The form is still available. ${localizedError(form.create.error)}`}
        </Notice>
      )}
      <form onSubmit={form.submit}>
        <label>
          {tr('common:itemName')}
          <input
            value={form.name}
            onChange={(event) => form.setName(event.target.value)}
            placeholder={tr('inventory:riceExample')}
            required
          />
        </label>
        <label>
          {tr('inventory:trackingMode')}
          <select
            value={form.mode}
            onChange={(event) =>
              form.setManualMode(event.target.value as TrackingMode)
            }
          >
            <option value="QUANTITY">{tr('common:quantity')}</option>
            <option value="FIVE_LEVEL">{tr('inventory:fiveLevels')}</option>
            <option value="PRESENCE_BACKUP">
              {tr('inventory:presentBackups')}
            </option>
          </select>
        </label>
        <label>
          {tr('common:primaryUnit')}
          <input
            value={form.unit}
            onChange={(event) => form.setManualUnit(event.target.value)}
            placeholder={
              form.mode === 'QUANTITY'
                ? tr('inventory:unitExample')
                : 'e.g. bottle, pack'
            }
            required
          />
        </label>
        <AddItemCatalogFields
          household={household}
          categories={form.categories}
          locations={form.locations}
          tags={form.tags}
          categoryId={form.categoryId}
          onCategoryChange={form.setCategoryId}
          locationId={form.locationId}
          onLocationChange={form.setLocationId}
          tagIds={form.tagIds}
          onTagIdsChange={form.setTagIds}
        />
        <AddItemStockFields
          mode={form.mode}
          quickPurchaseSeed={!!quickPurchaseSeed}
          quantity={form.quantity}
          onQuantityChange={form.setQuantity}
          expiry={form.expiry}
          onExpiryChange={form.setExpiry}
          level={form.level}
          onLevelChange={form.setLevel}
          present={form.present}
          onPresentChange={form.setPresent}
          backupCount={form.backupCount}
          onBackupCountChange={form.setBackupCount}
        />
        <p className="form-guidance" id="catalog-guidance" aria-live="polite">
          {formGuidance}
        </p>
        <Button
          className="wide"
          aria-describedby="catalog-guidance"
          disabled={!form.canSubmit}
        >
          {form.create.isPending
            ? tr('common:creating')
            : tr('common:createItem')}
        </Button>
      </form>
    </Card>
  );
}
