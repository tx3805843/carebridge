import * as React from "react";

export interface EntitySummaryMeta {
  label: string;
  value: React.ReactNode;
}

export interface EntitySummaryCardProps {
  title: string;
  subtitle?: string;
  meta?: EntitySummaryMeta[];
  actions?: React.ReactNode;
}

// Standard header for an entity detail page (client/provider/visit/invoice) — per the UX
// review's component inventory. Keeps identity, key facts, and record-level actions in one
// consistently-styled surface block instead of an ad hoc <h1> + <p>.
export function EntitySummaryCard({ title, subtitle, meta, actions }: EntitySummaryCardProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-md border border-border bg-surface p-5">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        {meta && meta.length > 0 ? (
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {meta.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex gap-1">
                <dt className="font-medium text-foreground">{item.label}:</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
