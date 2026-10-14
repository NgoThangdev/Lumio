import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Doodle, type IllustrationKey } from "./Doodle";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "link";
};
export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return <button className={`${variant} min-h-11 ${className}`.trim()} {...props} />;
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`card ${className}`.trim()} {...props} />;
}

export function Notice({
  kind,
  children,
}: {
  kind: "error" | "success";
  children: ReactNode;
}) {
  return <div className={`message ${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

/** Decorative art; the adjacent item name remains the accessible identity. */
export function ItemVisual({ name, large = false, illustrationKey }: { name: string; large?: boolean; illustrationKey?: IllustrationKey }) {
  return <span className={`item-visual${large ? " item-visual-large" : ""}`} aria-hidden="true"><Doodle kind={illustrationKey} itemName={illustrationKey ? undefined : name} /></span>;
}

export function StockBadge({ status }: { status?: string }) {
  const labels: Record<string, string> = { OK: "In stock", LOW: "Low stock", BUY: "Time to buy", OUT: "Out of stock", USE_SOON: "Use soon" };
  return <span className={`health health-${status?.toLowerCase() ?? "unknown"}`}><span aria-hidden="true">{status === "OK" ? "✓" : status === "USE_SOON" ? "◷" : status ? "!" : "·"}</span>{status ? labels[status] ?? status : "Status unavailable"}</span>;
}
