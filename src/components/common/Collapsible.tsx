import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleProps {
  /** Short heading that is always visible. */
  title: string;
  /** Optional one-line summary shown under the title while collapsed. */
  summary?: string;
  /** Words next to the chevron while collapsed. */
  openLabel?: string;
  /** Words next to the chevron while expanded. */
  closeLabel?: string;
  defaultOpen?: boolean;
  /** Keep the content in the page while collapsed (for forms that must not lose what was typed). */
  keepMounted?: boolean;
  /** "card" has a soft background and border; "plain" is just a line of text with the chevron. */
  variant?: 'card' | 'plain';
  className?: string;
  children: React.ReactNode;
}

/**
 * One expandable section: a short heading you can always see, and the longer text behind it. Works with the mouse,
 * the keyboard and touch (the whole heading row is the button), and in both themes.
 */
export const Collapsible: React.FC<CollapsibleProps> = ({
  title,
  summary,
  openLabel = 'Read more',
  closeLabel = 'Hide',
  defaultOpen = false,
  keepMounted = false,
  variant = 'card',
  className = '',
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const shell = variant === 'card' ? 'rounded-xl border border-slate-800 bg-slate-900/50' : '';

  return (
    <div className={`${shell} ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className={`w-full flex items-center justify-between gap-3 text-left cursor-pointer rounded-xl ${variant === 'card' ? 'px-3.5 py-2.5' : 'py-1.5'}`}
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-slate-200">{title}</span>
          {summary && !open && <span className="block text-[11px] text-slate-400 truncate">{summary}</span>}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-[11px] font-medium text-slate-400">
          <span>{open ? closeLabel : openLabel}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {(open || keepMounted) && (
        <div
          id={id}
          hidden={!open}
          className={`text-xs leading-relaxed text-slate-300 space-y-2 ${variant === 'card' ? 'px-3.5 pb-3' : 'pb-2'}`}
        >
          {children}
        </div>
      )}
    </div>
  );
};
