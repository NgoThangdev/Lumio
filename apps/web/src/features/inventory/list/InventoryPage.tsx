import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useHousehold } from '@/shared/household/HouseholdContext';
import { tr } from '@/shared/i18n';
import { AddItemForm } from '../add-item/AddItemForm';
import type { QuickPurchaseSeed } from '../add-item/useAddItemForm';
import { ArchivedItems } from './ArchivedItems';
import { InventoryFilters } from './InventoryFilters';
import { InventoryInsights } from './InventoryInsights';
import { InventoryResults } from './InventoryResults';
import { useInventoryFilters } from './useInventoryFilters';
import { useInventoryQueries } from './useInventoryQueries';

export function InventoryPage() {
  const household = useHousehold();
  const location = useLocation();
  const navigate = useNavigate();
  const initialAddItemScrollHandled = useRef(false);
  const addItemButton = useRef<HTMLAnchorElement>(null);
  const closeAddItemButton = useRef<HTMLButtonElement>(null);
  const addItemDialog = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const [mobileLayout, setMobileLayout] = useState(
    () => window.matchMedia('(max-width: 700px)').matches,
  );
  const [addItemOpen, setAddItemOpen] = useState(false);
  const modalVisible =
    mobileLayout && (addItemOpen || location.hash === '#add-item');
  const routeState = location.state as {
    quickPurchaseDraft?: Partial<QuickPurchaseSeed>;
  } | null;
  const seed = routeState?.quickPurchaseDraft;
  const quickPurchaseSeed =
    seed && typeof seed.name === 'string' && typeof seed.quantity === 'string'
      ? (seed as QuickPurchaseSeed)
      : undefined;
  const filters = useInventoryFilters();
  const [shoppingDate, setShoppingDate] = useState('');
  const queries = useInventoryQueries({
    householdId: household.id,
    query: filters.query,
    groupBy: filters.groupBy,
    shoppingDate,
  });
  const { inventory, categories, locations, tags, intelligence } = queries;
  const inventoryPageReady =
    !inventory.isPending &&
    !categories.isPending &&
    !locations.isPending &&
    !tags.isPending;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const update = () => setMobileLayout(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (initialAddItemScrollHandled.current || !inventoryPageReady) return;
    initialAddItemScrollHandled.current = true;
    if (window.location.hash !== '#add-item') return;
    if (mobileLayout) return;
    const target = document.getElementById('add-item');
    if (!target) return;
    window.requestAnimationFrame(() =>
      target.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }, [inventoryPageReady, location.hash, mobileLayout]);

  useEffect(() => {
    if (!modalVisible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() =>
      closeAddItemButton.current?.focus(),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [modalVisible]);

  const closeAddItem = () => {
    setAddItemOpen(false);
    if (location.hash === '#add-item') {
      void navigate(
        { pathname: location.pathname, search: location.search, hash: '' },
        { replace: true, state: location.state },
      );
    }
    window.requestAnimationFrame(() =>
      (returnFocusTo.current ?? addItemButton.current)?.focus(),
    );
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAddItem();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      addItemDialog.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const base = `/households/${household.id}`;
  return (
    <div className="inventory-page">
      <div className="grid inventory-grid">
        <section
          className="inventory-list"
          aria-label={tr('inventory:householdItems')}
        >
          <InventoryFilters
            base={base}
            search={filters.search}
            onSearchChange={(value) => {
              filters.setSearch(value);
              filters.setInventoryParam('q', value.trim(), '');
            }}
            status={filters.status}
            onStatusChange={(value) => {
              filters.setStatus(value);
              filters.setInventoryParam('status', value, 'ALL');
            }}
            groupBy={filters.groupBy}
            onGroupByChange={(value) => {
              filters.setGroupBy(value);
              filters.setInventoryParam('groupBy', value, 'location');
            }}
            categoryId={filters.categoryId}
            onCategoryChange={(value) => {
              filters.setCategoryId(value);
              filters.setInventoryParam('categoryId', value, '');
            }}
            locationId={filters.locationId}
            onLocationChange={filters.setLocationId}
            tagId={filters.tagId}
            onTagChange={(value) => {
              filters.setTagId(value);
              filters.setInventoryParam('tagId', value, '');
            }}
            hasAdvancedFilters={filters.hasAdvancedFilters}
            categories={categories}
            locations={locations}
            tags={tags}
          />
          <a
            className="primary inventory-add-button"
            href="#add-item"
            ref={addItemButton}
            onClick={(event) => {
              if (!mobileLayout) return;
              event.preventDefault();
              returnFocusTo.current = event.currentTarget;
              setAddItemOpen(true);
            }}
          >
            <span aria-hidden="true">＋</span> {tr('inventory:addItem2')}
          </a>
          {filters.locationId && (
            <div className="inventory-active-location">
              <span>
                {tr('inventory:showing')}{' '}
                {locations.data?.find(
                  (entry) => entry.id === filters.locationId,
                )?.name ?? tr('inventory:selectedLocation')}
              </span>
              <button type="button" onClick={() => filters.setLocationId('')}>
                {tr('inventory:clearLocation')}
              </button>
            </div>
          )}
          <InventoryResults
            inventory={inventory.data}
            isPending={inventory.isPending}
            error={inventory.error}
            groupBy={filters.groupBy}
            base={base}
            locations={locations.data}
            hasFilters={filters.hasFilters}
          />
        </section>
        <div
          className={`inventory-add-panel${modalVisible ? ' is-open' : ''}`}
          role={mobileLayout ? 'dialog' : undefined}
          aria-modal={modalVisible ? true : undefined}
          aria-labelledby={mobileLayout ? 'add-item-heading' : undefined}
          inert={mobileLayout && !modalVisible}
          ref={addItemDialog}
          onKeyDown={modalVisible ? handleDialogKeyDown : undefined}
        >
          <div className="inventory-add-dialog-content">
            <div className="inventory-add-dialog-bar">
              <button
                className="secondary"
                type="button"
                ref={closeAddItemButton}
                onClick={closeAddItem}
              >
                {tr('inventory:closeAddItem')}
              </button>
            </div>
            <AddItemForm
              household={household}
              quickPurchaseSeed={quickPurchaseSeed}
            />
          </div>
        </div>
      </div>
      {household.role === 'ADMIN' && (
        <ArchivedItems householdId={household.id} />
      )}
      <InventoryInsights
        base={base}
        data={intelligence.data}
        isPending={intelligence.isPending}
        error={intelligence.error}
        shoppingDate={shoppingDate}
        onShoppingDateChange={setShoppingDate}
      />
    </div>
  );
}
