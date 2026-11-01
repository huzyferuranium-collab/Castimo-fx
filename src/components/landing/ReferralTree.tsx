import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { REFERRAL_RATES_PCT } from '../../backend/referrals';

/**
 * The referral programme drawn as a small golden network: your account at the centre, the people
 * you invite around it, and the two levels beyond them.
 *
 * It is an illustration of the structure only. The rates come from the real referral settings; the
 * number of people drawn, and everything that moves, is decoration. No users, payments or earnings
 * are shown, and nothing here reads or claims live data. Tapping a node or a level chip explains
 * how that level pays.
 *
 * Motion is light on purpose: a few small gold sparks travelling along the links, a soft pulse round
 * your account, and a slow drift on the nodes. It pauses when the card is off screen, and it stays
 * still for visitors who ask their device for reduced motion.
 */

type Level = 1 | 2 | 3;
type Selection = { kind: 'node'; id: string } | { kind: 'level'; level: Level } | { kind: 'you' } | null;

interface NetNode {
  id: string;
  level: Level;
  x: number;
  y: number;
  r: number;
  parent: string; // id of the node it hangs from, or 'you'
  d: string; // link path, drawn from this node in towards its parent
  mid: { x: number; y: number };
  dur: number; // drift duration
  del: number; // drift delay
}

interface Net {
  w: number;
  h: number;
  cx: number;
  cy: number;
  rx: number[];
  ry: number[];
  nodes: NetNode[];
  specks: Array<{ x: number; y: number; r: number; o: number }>;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const f1 = (n: number) => n.toFixed(1);

// angle (degrees, 0 = right, 90 = down) and a small radius variation, so the layout feels grown rather than stamped
const SPEC: Record<Level, Array<[number, number]>> = {
  1: [[-52, 1], [12, 1.05], [88, 0.97], [152, 1.04], [228, 0.98]],
  2: [[-66, 1.02], [-24, 0.96], [26, 1.05], [64, 0.98], [112, 1.03], [160, 0.97], [204, 1.04], [-116, 0.99]],
  3: [[-72, 1], [-42, 1.04], [-10, 0.97], [22, 1.03], [50, 0.98], [80, 1.05], [108, 0.97], [138, 1.02], [166, 0.99], [196, 1.04], [224, 0.97], [250, 1.01]],
};
const NODE_R: Record<Level, number> = { 1: 14, 2: 10.5, 3: 6 };

function buildNet(compact: boolean): Net {
  const w = compact ? 420 : 640;
  const h = compact ? 372 : 384;
  const cx = w / 2;
  const cy = compact ? 188 : 192;
  const rx = compact ? [92, 152, 200] : [124, 208, 294];
  const ry = compact ? [70, 116, 164] : [64, 108, 160];

  const nodes: NetNode[] = [];
  const angDist = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  const byLevel: Record<Level, Array<{ id: string; a: number; x: number; y: number }>> = { 1: [], 2: [], 3: [] };

  ([1, 2, 3] as Level[]).forEach((level) => {
    SPEC[level].forEach(([a, k], i) => {
      const depth = 1 + 0.1 * Math.sin(rad(a)); // nodes towards the bottom sit a little closer
      const x = cx + rx[level - 1] * k * Math.cos(rad(a));
      const y = cy + ry[level - 1] * k * Math.sin(rad(a));
      const id = `l${level}-${i}`;
      const r = NODE_R[level] * depth;

      // hang it from the nearest node one level in
      let parent = 'you';
      let px = cx;
      let py = cy;
      if (level > 1) {
        let best = 999;
        byLevel[(level - 1) as Level].forEach((p) => {
          const dd = angDist(a, p.a);
          if (dd < best) {
            best = dd;
            parent = p.id;
            px = p.x;
            py = p.y;
          }
        });
      }

      // a gentle, alternating curve from the node in towards its parent
      const dx = px - x;
      const dy = py - y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const bend = (i % 2 === 0 ? 1 : -1) * 0.16 * len;
      const p1 = { x: x + dx * 0.3 + nx * bend, y: y + dy * 0.3 + ny * bend };
      const p2 = { x: x + dx * 0.7 + nx * bend * 0.6, y: y + dy * 0.7 + ny * bend * 0.6 };
      const t = 0.5;
      const mid = {
        x: (1 - t) ** 3 * x + 3 * (1 - t) ** 2 * t * p1.x + 3 * (1 - t) * t ** 2 * p2.x + t ** 3 * px,
        y: (1 - t) ** 3 * y + 3 * (1 - t) ** 2 * t * p1.y + 3 * (1 - t) * t ** 2 * p2.y + t ** 3 * py,
      };

      nodes.push({
        id,
        level,
        x,
        y,
        r,
        parent,
        d: `M${f1(x)} ${f1(y)} C${f1(p1.x)} ${f1(p1.y)} ${f1(p2.x)} ${f1(p2.y)} ${f1(px)} ${f1(py)}`,
        mid,
        dur: 5.2 + ((i * 7 + level * 3) % 9) * 0.45,
        del: -(((i * 5 + level) % 7) * 0.8),
      });
      byLevel[level].push({ id, a, x, y });
    });
  });

  // a few faint specks of dust, the same every time
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const specks: Net['specks'] = [];
  let guard = 0;
  while (specks.length < 26 && guard++ < 400) {
    const x = 10 + rnd() * (w - 20);
    const y = 8 + rnd() * (h - 16);
    const r = 0.7 + rnd() * 0.9;
    const o = 0.25 + rnd() * 0.4;
    if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < n.r + 12)) continue;
    if (Math.hypot(x - cx, y - cy) < 46) continue;
    specks.push({ x, y, r, o });
  }

  return { w, h, cx, cy, rx, ry, nodes, specks };
}

function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [match, setMatch] = useState<boolean>(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return match;
}

const RATE = (level: Level) => REFERRAL_RATES_PCT[level - 1];

const LEVEL_TEXT: Record<Level, { title: string; who: string }> = {
  1: { title: 'Level 1', who: 'People who join with your link.' },
  2: { title: 'Level 2', who: 'People your Level 1 invite.' },
  3: { title: 'Level 3', who: 'The next level out.' },
};

export const ReferralTree: React.FC<{ className?: string }> = ({ className = '' }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const g = (t: string) => `url(#${id}${t})`;
  const compact = useMedia('(max-width: 639px)');
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const net = useMemo(() => buildNet(compact), [compact]);
  const [sel, setSel] = useState<Selection>(null);
  const [visible, setVisible] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Stop all movement while the card is off screen
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const svg = svgRef.current as (SVGSVGElement & { pauseAnimations?: () => void; unpauseAnimations?: () => void }) | null;
    if (!svg) return;
    if (visible && !reduced) svg.unpauseAnimations?.();
    else svg.pauseAnimations?.();
  }, [visible, reduced, net]);

  const byId = useMemo(() => new Map(net.nodes.map((n) => [n.id, n])), [net]);
  // the route from a chosen node back to you
  const chain = useMemo(() => {
    const s = new Set<string>();
    if (sel?.kind === 'node') {
      let cur = byId.get(sel.id);
      while (cur) {
        s.add(cur.id);
        cur = cur.parent === 'you' ? undefined : byId.get(cur.parent);
      }
    }
    return s;
  }, [sel, byId]);

  const isOn = (n: NetNode) =>
    (sel?.kind === 'node' && sel.id === n.id) || (sel?.kind === 'level' && sel.level === n.level);
  const toggle = (next: Exclude<Selection, null>) =>
    setSel((cur) => {
      if (!cur) return next;
      if (cur.kind !== next.kind) return next;
      if (cur.kind === 'node' && next.kind === 'node') return cur.id === next.id ? null : next;
      if (cur.kind === 'level' && next.kind === 'level') return cur.level === next.level ? null : next;
      return null; // 'you' twice
    });

  // what the caption says
  let infoLevel: Level | null = null;
  if (sel?.kind === 'node') infoLevel = byId.get(sel.id)?.level ?? null;
  if (sel?.kind === 'level') infoLevel = sel.level;
  const info =
    sel?.kind === 'you'
      ? { title: 'You', body: 'Your account. When someone in your network pays and the payment is verified, you earn a commission.' }
      : infoLevel
        ? {
            title: `${LEVEL_TEXT[infoLevel].title} · ${RATE(infoLevel)}%`,
            body: `${LEVEL_TEXT[infoLevel].who} You earn ${RATE(infoLevel)}% of what they pay, once the payment is verified.`,
          }
        : null;

  const { w, h, cx, cy } = net;
  const lv = (n: NetNode) => `rf-l${n.level}`;
  const sparkNodes = net.nodes.filter((n) => n.level < 3 || Number(n.id.split('-')[1]) % 2 === 0);

  return (
    <div ref={wrapRef} className={`ref-universe ${visible ? '' : 'is-paused'} ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto block"
        role="group"
        aria-label={`Referral network: you at the centre. Level 1 pays ${RATE(1)}%, level 2 pays ${RATE(2)}% and level 3 pays ${RATE(3)}% of verified payments.`}
        onClick={() => setSel(null)}
      >
        <defs>
          <radialGradient id={`${id}orb`} cx="36%" cy="28%" r="85%"><stop offset="0" stopColor="#fff6d1" /><stop offset=".45" stopColor="#f2b705" /><stop offset="1" stopColor="#8a5a00" /></radialGradient>
          <radialGradient id={`${id}n1`} cx="36%" cy="28%" r="85%"><stop offset="0" stopColor="#fff0b3" /><stop offset=".5" stopColor="#efb91a" /><stop offset="1" stopColor="#8c5f00" /></radialGradient>
          <radialGradient id={`${id}n2`} cx="36%" cy="28%" r="85%"><stop offset="0" stopColor="#fffaf0" /><stop offset=".5" stopColor="#e8d29b" /><stop offset="1" stopColor="#8a7640" /></radialGradient>
          <radialGradient id={`${id}n3`} cx="36%" cy="28%" r="85%"><stop offset="0" stopColor="#ffffff" /><stop offset=".55" stopColor="#d8c898" /><stop offset="1" stopColor="#6a5e3d" /></radialGradient>
          <radialGradient id={`${id}glow`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#f5c542" stopOpacity=".55" /><stop offset=".5" stopColor="#f5c542" stopOpacity=".16" /><stop offset="1" stopColor="#f5c542" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${id}soft`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#f3dc9a" stopOpacity=".55" /><stop offset="1" stopColor="#f3dc9a" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${id}spark`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#fff6d6" stopOpacity="1" /><stop offset=".35" stopColor="#f5c542" stopOpacity=".95" /><stop offset="1" stopColor="#f5c542" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${id}coin`} cx="36%" cy="28%" r="85%"><stop offset="0" stopColor="#fff6d6" /><stop offset=".55" stopColor="#f0c040" /><stop offset="1" stopColor="#b8860b" /></radialGradient>
          {net.nodes.map((n) => (
            <path key={`p${n.id}`} id={`${id}p${n.id}`} d={n.d} />
          ))}
        </defs>

        {/* depth: three tinted discs, widest at the back, and a few specks of dust */}
        {[2, 1, 0].map((i) => (
          <ellipse key={`disc${i}`} className="rf-disc" cx={cx} cy={cy} rx={net.rx[i] + 22} ry={net.ry[i] + 20} fillOpacity={[0.075, 0.06, 0.05][i]} />
        ))}
        <ellipse cx={cx} cy={cy} rx={net.rx[1] * 0.8} ry={net.ry[1] * 0.9} fill={g('glow')} />
        {net.specks.map((s, i) => (
          <circle key={`s${i}`} className="rf-speck" cx={s.x} cy={s.y} r={s.r} fillOpacity={s.o} />
        ))}

        {/* orbit guides */}
        {[2, 1, 0].map((i) => (
          <ellipse key={`o${i}`} className={`rf-orbit rf-l${i + 1}`} cx={cx} cy={cy} rx={net.rx[i]} ry={net.ry[i]} />
        ))}

        {/* links, drawn from each node in towards the one it hangs from */}
        <g fill="none" strokeLinecap="round" pointerEvents="none">
          {net.nodes.map((n) => {
            const hot = chain.has(n.id) || (sel?.kind === 'level' && sel.level === n.level);
            const width = n.level === 1 ? 2.4 : n.level === 2 ? 1.6 : 1.1;
            return (
              <g key={`k${n.id}`}>
                {n.level === 1 && <path d={n.d} className={`rf-line ${lv(n)}`} strokeWidth={9} strokeOpacity={hot ? 0.22 : 0.1} />}
                <path d={n.d} className={`rf-line ${lv(n)}`} strokeWidth={hot ? width + 1.2 : width} strokeOpacity={hot ? 1 : n.level === 3 ? 0.55 : 0.8} />
                {n.level < 3 && <path d={n.d} className="rf-line rf-dash" strokeWidth={n.level === 1 ? 1.4 : 1} />}
              </g>
            );
          })}
        </g>

        {/* sparks travelling inwards along the links (replaced by still coins for reduced motion) */}
        <g pointerEvents="none">
          {reduced
            ? net.nodes
                .filter((n) => n.level === 1)
                .map((n) => (
                  <g key={`c${n.id}`}>
                    <circle cx={n.mid.x} cy={n.mid.y} r="5" fill={g('coin')} className="rf-coin" />
                    <circle cx={n.mid.x} cy={n.mid.y} r="2.6" fill="none" className="rf-coin-in" />
                  </g>
                ))
            : sparkNodes.map((n, i) => {
                const dur = n.level === 1 ? 3.4 + (i % 3) * 0.5 : n.level === 2 ? 4.2 + (i % 4) * 0.4 : 4.8 + (i % 3) * 0.5;
                const begin = `-${((i * 1.37) % dur).toFixed(2)}s`;
                return (
                  <g key={`m${n.id}`} opacity="0">
                    {n.level === 1 ? (
                      <>
                        <circle r="10" fill={g('spark')} opacity=".5" />
                        <circle r="4.6" fill={g('coin')} className="rf-coin" />
                        <circle r="2.4" fill="none" className="rf-coin-in" />
                      </>
                    ) : (
                      <>
                        <circle r={n.level === 2 ? 6.5 : 5} fill={g('spark')} opacity=".75" />
                        <circle r={n.level === 2 ? 1.9 : 1.5} fill="#fff6d6" />
                      </>
                    )}
                    <animateMotion dur={`${dur}s`} begin={begin} repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines=".35 0 .65 1" rotate="0">
                      <mpath href={`#${id}p${n.id}`} />
                    </animateMotion>
                    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.8;1" dur={`${dur}s`} begin={begin} repeatCount="indefinite" />
                  </g>
                );
              })}
        </g>

        {/* people: outermost first so nearer ones sit on top */}
        {[...net.nodes]
          .sort((a, b) => b.level - a.level)
          .map((n) => {
            const on = isOn(n);
            return (
              <g key={`n${n.id}`} transform={`translate(${f1(n.x)} ${f1(n.y)})`} aria-hidden="true">
                <g className="rf-float" style={{ ['--rf-dur' as string]: `${n.dur}s`, ['--rf-del' as string]: `${n.del}s` } as React.CSSProperties}>
                  <g
                    className={`rf-node ${on ? 'is-on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle({ kind: 'node', id: n.id });
                    }}
                  >
                    <circle r={Math.max(n.r + 9, 16)} fill="transparent" />
                    <g className="rf-body">
                      {n.level === 3 && <circle r={n.r * 2.8} fill={g('soft')} />}
                      <circle r={n.r} fill={g(`n${n.level}`)} className="rf-rim" />
                      {n.level < 3 && (
                        <>
                          <circle cy={-n.r * 0.22} r={n.r * 0.27} className="rf-ink" />
                          <path d={`M${f1(-n.r * 0.5)} ${f1(n.r * 0.56)} a${f1(n.r * 0.5)} ${f1(n.r * 0.44)} 0 0 1 ${f1(n.r)} 0 Z`} className="rf-ink" />
                        </>
                      )}
                      <ellipse cx={-n.r * 0.3} cy={-n.r * 0.5} rx={n.r * 0.42} ry={n.r * 0.2} fill="#fff" opacity=".4" transform={`rotate(-28 ${f1(-n.r * 0.3)} ${f1(-n.r * 0.5)})`} />
                    </g>
                    <circle r={n.r + 5} fill="none" className={`rf-ring ${lv(n)}`} />
                  </g>
                </g>
              </g>
            );
          })}

        {/* your account */}
        <g transform={`translate(${cx} ${cy})`}>
          <circle r="86" fill={g('glow')} />
          <circle r="33" fill="none" className="rf-line rf-l1 rf-pulse" strokeWidth="1.5" />
          <circle r="33" fill="none" className="rf-line rf-l1 rf-pulse rf-pulse-b" strokeWidth="1.5" />
          <g
            role="button"
            tabIndex={0}
            aria-label="You: tap to see how you earn"
            aria-pressed={sel?.kind === 'you'}
            className={`rf-node rf-you ${sel?.kind === 'you' ? 'is-on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle({ kind: 'you' });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle({ kind: 'you' });
              }
            }}
          >
            <circle r="40" fill="transparent" />
            <g className="rf-body">
              <circle r="30" fill={g('orb')} className="rf-rim" />
              <circle r="25" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1" />
              <circle cy="-7" r="8.4" className="rf-ink" />
              <path d="M-15 18 a15 13.5 0 0 1 30 0 Z" className="rf-ink" />
              <ellipse cx="-9" cy="-16" rx="12" ry="6" fill="#fff" opacity=".35" transform="rotate(-28 -9 -16)" />
            </g>
            <circle r="36" fill="none" className="rf-ring rf-l1" />
          </g>
        </g>

        {/* level chips: also work as buttons, so every level can be reached from the keyboard */}
        {([3, 2, 1] as Level[]).map((level) => {
          const y = cy - net.ry[level - 1];
          const on = sel?.kind === 'level' && sel.level === level;
          return (
            <g
              key={`chip${level}`}
              transform={`translate(${cx} ${f1(y)})`}
              role="button"
              tabIndex={0}
              aria-label={`Level ${level}, ${RATE(level)} percent: tap to see how it pays`}
              aria-pressed={on}
              className={`rf-node rf-chip ${on ? 'is-on' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                toggle({ kind: 'level', level });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle({ kind: 'level', level });
                }
              }}
            >
              <rect x="-31" y="-12" width="62" height="24" rx="12" className="rf-chip-bg" />
              <text x="0" y="4.6" textAnchor="middle" className="rf-chip-text">
                <tspan className="rf-chip-l">L{level}</tspan>
                <tspan dx="5" className="rf-chip-p">{RATE(level)}%</tspan>
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 min-h-[3.4rem] sm:min-h-[2.4rem] flex items-start justify-center" aria-live="polite">
        <p key={info ? info.title : 'idle'} className="text-[11px] leading-snug text-center text-balance text-slate-600 dark:text-slate-400 max-w-md animate-in fade-in duration-200">
          {info ? (
            <>
              <span className="font-bold text-amber-700 dark:text-amber-300">{info.title}.</span> {info.body}
            </>
          ) : (
            'You at the centre; each level pays on verified payments. Tap a node or a level to see how.'
          )}
        </p>
      </div>
    </div>
  );
};
