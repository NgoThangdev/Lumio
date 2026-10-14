import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHousehold } from "../../app/useHousehold";
import { ApiError, api, isMutationOutcomeUnknown } from "../../shared/api/client";
import { keys } from "../../shared/api/keys";
import type { CatalogOption, Item, TrackingMode } from "../../shared/api/types";
import { ItemVisual, Notice } from "../../shared/ui/primitives";

function validAmount(value: string, mode: TrackingMode, wholePackages: boolean) {
  if (mode !== "QUANTITY") {
    return /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647;
  }
  return (wholePackages ? /^\d+$/ : /^\d+(?:\.\d{1,6})?$/).test(value) && Number(value) > 0;
}

export function QuickPurchasePage() {
  const household = useHousehold();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = `/households/${household.id}`;
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [amount, setAmount] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [locationChoice, setLocationChoice] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const items = useQuery({
    queryKey: keys.items(household.id),
    queryFn: () => api<Item[]>(`${base}/items`),
  });
  const locations = useQuery({
    queryKey: keys.catalog(household.id, "locations"),
    queryFn: () => api<CatalogOption[]>(`/households/${household.id}/locations`),
  });
  const selectedItem = items.data?.find((item) => item.id === selectedId);
  const detail = useQuery({
    queryKey: keys.item(household.id, selectedId),
    queryFn: () => api<Item>(`${base}/items/${selectedId}`),
    enabled: !!selectedId,
  });
  const item = detail.data ?? selectedItem;
  const mode = item?.trackingMode;
  const openingKnown = typeof item?.openedTrackingEnabled === "boolean";
  const wholePackages = mode === "QUANTITY" && item?.openedTrackingEnabled === true;
  const locationId = locationChoice ?? item?.preferredRestockLocation?.id ?? "";
  const mutation = useMutation({
    mutationFn: async ({ itemId, trackingMode, quantity, expiry, locationId: selectedLocationId }: { itemId: string; trackingMode: TrackingMode; quantity: string; expiry: string; locationId?: string }) => {
      if (trackingMode === "QUANTITY") {
        return api<unknown>(`${base}/items/${itemId}/restock`, "POST", {
          quantity,
          expiryDate: expiry || null,
          ...(selectedLocationId ? { locationId: selectedLocationId } : {}),
        });
      }
      return api<unknown>(`${base}/items/${itemId}/state/backups`, "POST", {
        count: amount,
      });
    },
  });
  const matches = (items.data ?? []).filter((entry) =>
    search.trim() && entry.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  async function refreshAffectedData(itemId: string) {
    const results = await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: keys.item(household.id, itemId), exact: true, refetchType: "all" }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: keys.items(household.id), refetchType: "all" }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: keys.needsAttention(household.id), refetchType: "all" }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: keys.recentActivity(household.id), refetchType: "all" }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: ["household", household.id, "intelligence"], refetchType: "all" }, { throwOnError: true }),
    ]);
    return results.every((result) => result.status === "fulfilled");
  }

  async function submitPurchase() {
    if (!item || !mode || mutation.isPending || !validAmount(amount, mode, wholePackages)) return;
    setFailure("");
    setSaved("");
    setRefreshWarning("");
    try {
      await mutation.mutateAsync({ itemId: item.id, trackingMode: mode, quantity: amount, expiry: expiryDate, ...(mode === "QUANTITY" && locationId ? { locationId } : {}) });
      setSaved("Purchase saved.");
      setAmount("");
      setExpiryDate("");
      if (!await refreshAffectedData(item.id)) {
        setRefreshWarning("The purchase was saved, but some inventory views could not refresh. Open Inventory or Item Detail to check the latest stock and activity.");
      }
    } catch (cause) {
        setFailure(cause instanceof ApiError && cause.code === "LOCATION_REQUIRED" && cause.itemId === item.id ? "" : isMutationOutcomeUnknown(cause)
        ? "We couldn't confirm the result. Stock may already have changed. Keep this draft and check Inventory or Item Detail activity before choosing to retry."
        : cause instanceof Error ? `Purchase rejected. Your draft is still here. ${cause.message}` : "Purchase rejected. Your draft is still here.");
    }
  }

  async function retryAfterChoosingLocation() {
    if (!item || mode !== "QUANTITY" || !locationId || mutation.isPending) return;
    setFailure("");
    try {
      await mutation.mutateAsync({ itemId: mutation.error instanceof ApiError && mutation.error.itemId ? mutation.error.itemId : item.id, trackingMode: mode, quantity: amount, expiry: expiryDate, locationId });
      setSaved("Purchase saved.");
      setAmount(""); setExpiryDate(""); setLocationChoice(null);
      if (!await refreshAffectedData(item.id)) setRefreshWarning("The purchase was saved, but some inventory views could not refresh. Open Inventory or Item Detail to check the latest stock and activity.");
    } catch (cause) {
      setFailure(isMutationOutcomeUnknown(cause)
        ? "We couldn't confirm the result. Stock may already have changed. Keep this draft and check Inventory or Item Detail activity before choosing to retry."
        : cause instanceof Error ? `Purchase rejected. Your draft is still here. ${cause.message}` : "Purchase rejected. Your draft is still here.");
    }
  }

  function addNewItem() {
    navigate(`${base}/inventory#add-item`, {
      state: { quickPurchaseDraft: { name: search.trim(), quantity: amount } },
    });
  }

  return <div className="quick-purchase-page">
    <div className="quick-purchase-heading">
      <div><p className="eyebrow">Shopping · Quick Purchase</p><h2>Save what you bought</h2><p className="muted">Add it to home inventory now. This won’t create a Shopping Trip.</p></div>
      <Link className="secondary" to={`${base}/shopping`}>← Shopping</Link>
    </div>
    {failure && <Notice kind="error">{failure}</Notice>}
    {saved && <Notice kind="success">{saved}</Notice>}
    {refreshWarning && <Notice kind="error">{refreshWarning}</Notice>}
    {items.isError && <Notice kind="error">Inventory items could not be loaded: {items.error.message}</Notice>}
    <section className="card quick-purchase-card">
      <label>Find an item<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId(""); setAmount(""); setExpiryDate(""); setSaved(""); setFailure(""); }} placeholder="Search your inventory…" disabled={mutation.isPending} /></label>
      {items.isPending ? <p className="muted" role="status">Loading inventory…</p> : items.isError ? <button type="button" className="secondary quick-purchase-new" onClick={() => void items.refetch()}>Retry inventory search</button> : search.trim() && !selectedId && (
        matches.length ? <div className="quick-purchase-results" aria-label="Matching inventory items">
          {matches.map((entry) => <button className="row quick-purchase-result" key={entry.id} type="button" disabled={mutation.isPending} onClick={() => { setSelectedId(entry.id); setAmount(""); setExpiryDate(""); setLocationChoice(null); setSaved(""); setFailure(""); mutation.reset(); }}>
            <ItemVisual name={entry.name} /><span className="item-identity"><strong>{entry.name}</strong><small>{entry.trackingMode === "QUANTITY" ? entry.primaryUnit : entry.trackingMode === "FIVE_LEVEL" ? "Five-level · backups" : "Presence · backups"}</small></span><span aria-hidden="true">›</span>
          </button>)}
        </div> : <div className="quick-purchase-new-draft">
          <p className="muted">No matching item yet. Add it with the initial state you see at home.</p>
          <label>Amount bought<input type="number" min="0.000001" step="0.000001" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Enter the purchased amount" disabled={mutation.isPending} /></label>
          <p className="muted">For a quantity item, this becomes initial stock. If you choose a backup mode next, enter its current state and backup count there.</p>
          <button type="button" className="secondary quick-purchase-new" disabled={mutation.isPending || !validAmount(amount, "QUANTITY", false)} onClick={addNewItem}>Continue to Add Item</button>
        </div>
      )}
      {selectedId && (detail.isPending ? <p className="muted" role="status">Loading item details…</p> :
        detail.isError ? <Notice kind="error">Item details could not be loaded: {detail.error.message}</Notice> :
        !item || !mode ? <Notice kind="error">This item’s tracking mode is unavailable. Refresh Inventory before saving a purchase.</Notice> :
        <div className="quick-purchase-selected">
          <div className="quick-purchase-picked"><ItemVisual name={item.name} /><div><strong>{item.name}</strong><small>{mode === "QUANTITY" ? item.primaryUnit : mode === "FIVE_LEVEL" ? "Five-level · backup units" : "Presence · backup units"}</small></div><button type="button" className="link" disabled={mutation.isPending} onClick={() => { setSelectedId(""); setLocationChoice(null); setSaved(""); mutation.reset(); }}>Change</button></div>
          {mode === "QUANTITY" && !openingKnown && <Notice kind="error">Opening policy could not be confirmed. Reload Item Detail before recording this purchase.</Notice>}
          <label>{mode === "QUANTITY" ? wholePackages ? `Whole packages bought (${item.primaryUnit})` : `Actual quantity bought (${item.primaryUnit})` : "Backup units bought"}
            <input type="number" min={mode === "QUANTITY" && !wholePackages ? "0.000001" : "1"} max={mode === "QUANTITY" ? undefined : "2147483647"} step={mode === "QUANTITY" && !wholePackages ? "0.000001" : "1"} inputMode={mode === "QUANTITY" && !wholePackages ? "decimal" : "numeric"} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={mode === "QUANTITY" ? wholePackages ? "Enter whole package count" : "Enter actual amount" : "Enter whole backup count"} disabled={mutation.isPending || (mode === "QUANTITY" && !openingKnown)} />
          </label>
          {mode === "QUANTITY" && wholePackages && <p className="muted">Opening tracking is on, so purchases must be whole packages.</p>}
          {mode === "QUANTITY" && <label>Expiry <em>optional</em><input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} disabled={mutation.isPending} /></label>}
          {mode === "QUANTITY" && <>
            {locations.isError && !item.preferredRestockLocation?.id && <Notice kind="error">Household locations could not be loaded: {locations.error.message}</Notice>}
            <label>Stock location<select value={locationId} onChange={(event) => setLocationChoice(event.target.value)} disabled={mutation.isPending || locations.isPending || locations.isError}><option value="">Choose a location</option>{locations.data?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.id === item.preferredRestockLocation?.id ? " · preferred" : ""}</option>)}</select></label>
            {item.preferredRestockLocation?.name && <p className="muted">Preferred for future stock writes: {item.preferredRestockLocation.name}. Existing batches may be in other locations.</p>}
          </>}
          {mutation.error instanceof ApiError && mutation.error.code === "LOCATION_REQUIRED" && mutation.error.itemId === item.id && <>
            <Notice kind="error">Choose a location for {mutation.error.itemId}. No stock was recorded.</Notice>
            <button type="button" className="secondary wide" disabled={mutation.isPending || !locationId || locations.isError} onClick={() => void retryAfterChoosingLocation()}>Confirm location and retry purchase</button>
          </>}
          {mode !== "QUANTITY" && <p className="muted">The purchase adds backups. It leaves the current level or presence unchanged.</p>}
          <button type="button" className="primary wide" disabled={mutation.isPending || (mode === "QUANTITY" && !openingKnown) || !validAmount(amount, mode, wholePackages)} onClick={() => void submitPurchase()}>{mutation.isPending ? "Saving purchase…" : "Save purchase"}</button>
        </div>
      )}
    </section>
  </div>;
}
