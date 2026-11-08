import type { ReactNode } from "react";
import { IconApprovals, IconLink, IconRefresh } from "../components/icons.js";

function SummaryCard(props: { icon: ReactNode; title: string; value: string; note: string }) {
  const id = `card-${props.title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section className="summary" aria-labelledby={id}>
      <div className="summary-icon">{props.icon}</div>
      <h2 id={id} className="summary-title">
        {props.title}
      </h2>
      <p className="summary-value">{props.value}</p>
      <p className="summary-note">{props.note}</p>
    </section>
  );
}

const STEPS = [
  ["Check suppliers", "Stock is read from each supplier's website on a schedule you choose."],
  ["Propose changes", "When supplier stock differs from your store, a change is proposed."],
  ["You approve", "Review the current and proposed values. Approve, edit or reject."],
  ["Update Shopify", "Only approved changes are sent to your store, and the result is recorded."],
] as const;

export function DashboardPage() {
  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="muted">A quick view of your suppliers and what needs your approval.</p>
      </div>

      <div className="summary-grid">
        <SummaryCard icon={<IconLink />} title="Supplier connections" value="0" note="No suppliers yet." />
        <SummaryCard icon={<IconRefresh />} title="Stock checks" value="None" note="No checks scheduled." />
        <SummaryCard
          icon={<IconApprovals />}
          title="Waiting for your approval"
          value="0"
          note="Nothing to review. Proposed Shopify changes will appear here."
        />
      </div>

      <section className="panel" aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol className="steps" aria-labelledby="how-heading">
          {STEPS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
