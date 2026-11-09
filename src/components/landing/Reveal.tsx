import React, { useEffect, useRef, useState } from 'react';

/** True once the element has scrolled into view (or right away where IntersectionObserver is missing). */
export function useInView<T extends HTMLElement>(threshold = 0.15): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

/** Fades and lifts its children in when they scroll into view. */
export const Reveal: React.FC<{ children: React.ReactNode; delay?: number; className?: string }> = ({
  children,
  delay = 0,
  className = '',
}) => {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`reveal ${seen ? 'is-in' : ''} ${className}`}
      style={{ ['--reveal-delay' as string]: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

/** Counts up to a number when it scrolls into view. Shows the final value straight away for reduced motion. */
export const CountUp: React.FC<{ to: number; prefix?: string; suffix?: string; duration?: number }> = ({
  to,
  prefix = '',
  suffix = '',
  duration = 1100,
}) => {
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [value, setValue] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!seen || reduce) {
      if (reduce) setValue(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(to * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to, duration, reduce]);
  return (
    <span ref={ref}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
};
