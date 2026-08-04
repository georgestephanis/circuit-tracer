import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  /** Shown next to the title so a collapsed section still tells you what's in it. */
  count: number;
  /** Sections start open; pass false for ones that are usually noise. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A collapsible sidebar section with its own scroll area.
 *
 * The lists inside are unbounded — a real board has hundreds of traces — so
 * each section scrolls independently rather than pushing every other section
 * off the screen.
 */
export function SidebarSection({ title, count, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="sidebar-section">
      <button
        type="button"
        className="sidebar-section-header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sidebar-section-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <h3>{title}</h3>
        <span className="sidebar-section-count">{count}</span>
      </button>
      {open && <div className="sidebar-section-body">{children}</div>}
    </div>
  );
}
