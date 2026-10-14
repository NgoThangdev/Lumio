import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useHousehold } from "../../app/useHousehold";
import { ApiError, api } from "../../shared/api/client";
import { keys } from "../../shared/api/keys";
import type { LocationCheckItem, LocationStockCheck, StockLevel } from "../../shared/api/types";
import { Button, Card, Notice } from "../../shared/ui/primitives";

const levels: StockLevel[] = ["FULL", "THREE_QUARTERS", "HALF", "QUARTER", "EMPTY"];

function showReason(reason: LocationCheckItem["reason"]) {
  const labels: Record<LocationCheckItem["reason"], string> = {
    STOCK_CHANGED: "Stock changed since the last check",
    MISSING_STATE: "Current state is missing",
    NO_STOCK_RECORD: "No stock record at this location",
    STALE_RECORD: "This stock record is over 30 days old",
    RECENT_RECORD: "Recent stock record",
  };
  return labels[reason];
}

export function LocationStockCheckPage() {
  const household = useHousehold();
  const { locationId = "" } = useParams();
  const queryClient = useQueryClient();
  const queryKey = keys.locationStockCheck(household.id, locationId);
  const check = useQuery({
    queryKey,
    queryFn: () => api<LocationStockCheck>(`/households/${household.id}/locations/${locationId}/stock-check`),
    enabled: Boolean(locationId),
  });

  if (check.isPending) return <Card><p className="muted" role="status">Loading location checklist…</p></Card>;
  if (check.isError) return <>
    <Notice kind="error">Location checklist could not be loaded: {check.error.message}</Notice>
    <Button type="button" variant="secondary" onClick={() => void check.refetch()}>Retry checklist</Button>
  </>;
  if (!check.data) return <Notice kind="error">Location checklist is unavailable.</Notice>;

  return <main className="location-stock-check-page">
    <div className="location-check-heading">
      <div><p className="eyebrow">Inventory · Location check</p><h2>{check.data.location.name}</h2><p className="muted">Confirm what is physically here. Items stay in the API’s checklist order.</p></div>
      <Link className="secondary" to={`/households/${household.id}/inventory`}>← Inventory</Link>
    </div>
    {check.data.items.length === 0 ? <Card className="empty"><h3>No items are assigned to this location</h3><p className="muted">Items appear here when their stock or preferred placement belongs to {check.data.location.name}.</p></Card> :
      <div className="location-check-list">
        {check.data.items.map((item) => <LocationCheckCard
          key={`${item.itemId}-${item.stockRevision}`}
          item={item}
          householdId={household.id}
          locationId={locationId}
          refresh={async (savedItem) => {
            queryClient.setQueryData<LocationStockCheck>(queryKey, (current) => current && ({
              ...current,
              items: current.items.map((entry) => entry.itemId === savedItem.itemId ? savedItem : entry),
            }));
            await queryClient.invalidateQueries({ queryKey: keys.household(household.id), refetchType: "all" });
          }}
          refetch={check.refetch}
        />)}
      </div>}
  </main>;
}

function LocationCheckCard({ item, householdId, locationId, refresh, refetch }: {
  item: LocationCheckItem;
  householdId: string;
  locationId: string;
  refresh: (item: LocationCheckItem) => Promise<void>;
  refetch: () => Promise<{ data: LocationStockCheck | undefined }>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [batchEditing, setBatchEditing] = useState(false);
  const [quantity, setQuantity] = useState(item.stock.quantity ?? "");
  const [batchCounts, setBatchCounts] = useState<Record<string, string>>({});
  const [extraQuantity, setExtraQuantity] = useState("0");
  const [extraExpiry, setExtraExpiry] = useState("");
  const [level, setLevel] = useState<StockLevel | "">(item.stock.currentLevel ?? "");
  const [presence, setPresence] = useState(item.stock.isPresent === true ? "true" : item.stock.isPresent === false ? "false" : "");
  const [backups, setBackups] = useState(String(item.stock.backupCount ?? 0));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [freshDecisionRequired, setFreshDecisionRequired] = useState(false);
  const [batchDataUnavailable, setBatchDataUnavailable] = useState(false);
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ item: LocationCheckItem; changed: boolean }>(
      `/households/${householdId}/locations/${locationId}/stock-check/${item.itemId}`,
      "PUT",
      body,
    ),
  });

  const run = async (body: Record<string, unknown>, successText: string) => {
    setError(""); setMessage(""); setFreshDecisionRequired(false); setBatchDataUnavailable(false);
    try {
      const result = await mutation.mutateAsync({ expectedRevision: item.stockRevision, ...body });
      await refresh(result.item);
      setCorrecting(false); setBatchEditing(false);
      setMessage(successText);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : null;
      if (code === "BATCH_DETAIL_REQUIRED") {
        const reloaded = await refetch();
        const observedItem = reloaded.data?.items.find((entry) => entry.itemId === item.itemId);
        const observedBatches = observedItem?.stock.batches ?? [];
        const positive = observedBatches.filter((batch) => Number(batch.quantity) > 0);
        if (positive.length) {
          setBatchCounts(Object.fromEntries(positive.map((batch) => [batch.id, batch.quantity])));
          setBatchEditing(true);
          setCorrecting(true);
        } else {
          setBatchDataUnavailable(true);
        }
        setError("The API needs a count for each positive batch at this location. Review the returned batch details below.");
      } else if (code === "STOCK_CHANGED") {
        setFreshDecisionRequired(true);
        setError("Stock changed before this check was saved. The checklist was refreshed; review the latest values and make a new decision.");
        await refetch();
      } else {
        setError(cause instanceof Error ? cause.message : "The location check could not be saved.");
      }
    }
  };

  const checkedAt = item.checkedAt ? new Date(item.checkedAt).toLocaleString() : null;
  const orderedPositiveBatches = (item.stock.batches ?? []).filter((batch) => Number(batch.quantity) > 0);

  return <Card className={`location-check-item status-${item.status.toLowerCase()}`}>
    <div className="location-check-item-heading">
      <div><p className="eyebrow">{item.trackingMode.replaceAll("_", " ")}</p><h3>{item.name}</h3></div>
      <span className={`location-check-status location-check-status-${item.status.toLowerCase()}`}>{item.status.replaceAll("_", " ")}</span>
    </div>
    <p className="location-check-reason">{showReason(item.reason)}</p>
    {item.trackingMode === "QUANTITY" ? <div className="location-check-stock">
      <strong>{item.stock.quantity ?? "—"}</strong> <span>at this location</span>
      {!!item.stock.batches?.length && <div className="location-check-batches">
        {item.stock.batches.map((batch) => <div className="location-check-batch" key={batch.id}>
          <span>{batch.quantity} · {batch.openedAt ? `opened ${batch.openedAt.slice(0, 10)}` : "unopened"}</span>
          <small>{batch.expiryDate ? `Expires ${batch.expiryDate}` : "No expiry"}{batch.openedUseByDate ? ` · use by ${batch.openedUseByDate}` : ""}</small>
        </div>)}
      </div>}
      {item.openedTrackingEnabled && <p className="muted">Opening tracking is on. The API validates whole package counts and opened batch limits.</p>}
    </div> : <div className="location-check-stock state-check-stock">
      {Object.hasOwn(item.stock, "currentLevel") && <p>Current level: <strong>{item.stock.currentLevel?.replaceAll("_", " ").toLowerCase() ?? "Not recorded"}</strong></p>}
      {Object.hasOwn(item.stock, "isPresent") && <p>Current item: <strong>{item.stock.isPresent === null ? "Not recorded" : item.stock.isPresent ? "Present" : "Absent"}</strong></p>}
      {Object.hasOwn(item.stock, "backupCount") && <p>Backups at this location: <strong>{item.stock.backupCount}</strong></p>}
      {!Object.keys(item.stock).length && <p className="muted">No current or backup stock fields are assigned to this location.</p>}
    </div>}
    {checkedAt && <p className="muted location-check-saved">Last checked {checkedAt}{item.checkedByUserId ? " · saved by a household member" : ""}</p>}
    {message && <Notice kind="success">{message}</Notice>}
    {error && <Notice kind="error">{error}</Notice>}
    {(freshDecisionRequired || item.status === "STALE") && <p className="muted" role="status">Review the latest stock and revision before choosing Confirm or Correct. No request was retried.</p>}
    {batchDataUnavailable && <p className="muted">The checklist did not return current batch details, so batch correction is unavailable until the API provides them.</p>}
    <div className="location-check-actions">
      <Button type="button" disabled={mutation.isPending} onClick={() => void run({ decision: "CONFIRM" }, "Stock confirmed for this location.")}>{mutation.isPending ? "Saving…" : "Confirm stock here"}</Button>
      <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={() => { setError(""); setMessage(""); setBatchEditing(false); setCorrecting((current) => !current); }}>{correcting ? "Close correction" : "Correct stock"}</Button>
    </div>
    {correcting && <form className="location-check-correction" onSubmit={(event) => {
      event.preventDefault();
      if (item.trackingMode === "QUANTITY") {
        if (batchEditing) {
          void run({ decision: "CORRECT", quantity, batches: orderedPositiveBatches.map((batch) => ({ batchId: batch.id, quantity: batchCounts[batch.id] ?? batch.quantity })), extraUnopenedQuantity: extraQuantity || "0", ...(Number(extraQuantity) > 0 && extraExpiry ? { extraExpiryDate: extraExpiry } : {}) }, "Location stock correction saved.");
        } else {
          void run({ decision: "CORRECT", quantity }, "Location stock correction saved.");
        }
      } else {
        const observation: Record<string, unknown> = { decision: "CORRECT" };
        if (Object.hasOwn(item.stock, "currentLevel") && level) observation.currentLevel = level;
        if (Object.hasOwn(item.stock, "isPresent") && presence !== "") observation.isPresent = presence === "true";
        if (Object.hasOwn(item.stock, "backupCount")) observation.backupCount = Number(backups);
        void run(observation, "Location state correction saved.");
      }
    }}>
      {item.trackingMode === "QUANTITY" ? <>
        <label>Total quantity at {"this location"}<input type="number" min="0" step="0.000001" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
        {!batchEditing ? <p className="muted">This changes only stock assigned to this location. It does not change batches elsewhere.</p> : <>
          {orderedPositiveBatches.map((batch) => <label className="batch-observation" key={batch.id}>
            Batch {batch.id.slice(0, 8)} · {batch.openedAt ? "opened" : "unopened"} · {batch.expiryDate ? `expires ${batch.expiryDate}` : "no expiry"}
            <input type="number" min="0" step={item.openedTrackingEnabled && !batch.openedAt ? "1" : "0.000001"} inputMode="decimal" value={batchCounts[batch.id] ?? batch.quantity} onChange={(event) => setBatchCounts((current) => ({ ...current, [batch.id]: event.target.value }))} required />
          </label>)}
          <label>Additional unopened quantity<input type="number" min="0" step={item.openedTrackingEnabled ? "1" : "0.000001"} inputMode={item.openedTrackingEnabled ? "numeric" : "decimal"} value={extraQuantity} onChange={(event) => setExtraQuantity(event.target.value)} /></label>
          {Number(extraQuantity) > 0 && <label>Expiry for additional quantity <em>optional</em><input type="date" value={extraExpiry} onChange={(event) => setExtraExpiry(event.target.value)} /></label>}
          <p className="muted">Batch IDs and expiry/opened details come from the API. The API validates the entered observations and total.</p>
        </>}
      </> : <>
        {Object.hasOwn(item.stock, "currentLevel") && <label>Current level<select value={level} onChange={(event) => setLevel(event.target.value as StockLevel | "")} required><option value="">Choose observed level</option>{levels.map((entry) => <option key={entry} value={entry}>{entry.replaceAll("_", " ").toLowerCase()}</option>)}</select></label>}
        {Object.hasOwn(item.stock, "isPresent") && <label>Current item<select value={presence} onChange={(event) => setPresence(event.target.value)} required><option value="">Choose observed state</option><option value="true">Present</option><option value="false">Absent</option></select></label>}
        {Object.hasOwn(item.stock, "backupCount") && <label>Backups at this location<input type="number" min="0" step="1" inputMode="numeric" value={backups} onChange={(event) => setBackups(event.target.value)} required /></label>}
      </>}
      <Button type="submit" variant="secondary" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : batchEditing ? "Save batch observations" : "Save correction"}</Button>
    </form>}
  </Card>;
}
