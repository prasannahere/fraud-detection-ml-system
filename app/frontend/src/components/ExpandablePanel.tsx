import type { MouseEvent, ReactNode } from "react";

const INTERACTIVE_SELECTOR =
  "button, input, a, select, textarea, .th-btn, tr, .filter-group, .search-input, .timeline-toolbar, .js-plotly-plot";

type Props = {
  onExpand: () => void;
  children: ReactNode;
};

export function ExpandablePanel({ onExpand, children }: Props) {
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    onExpand();
  };

  return (
    <div className="expandable-panel-slot" onClick={handleClick}>
      {children}
    </div>
  );
}
