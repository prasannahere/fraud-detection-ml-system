import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  onClose: () => void;
  children: ReactNode;
};

export function PanelOverlay({ onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return createPortal(
    <div className="panel-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="panel-overlay-backdrop" aria-hidden="true" />
      <div className="panel-overlay-frame" onClick={(e) => e.stopPropagation()}>
        <div className="panel-overlay-stage">{children}</div>
      </div>
    </div>,
    document.body
  );
}
