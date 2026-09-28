import { useEffect, useRef, useState } from "react";
import "../styles/routine.css";

/** Original, dependency-free illustration; motion runs only while the section is visible. */
export function RoutineIllustration() {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!container.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} className={`routine-visual${visible ? " is-visible" : ""}`}>
    <svg viewBox="0 0 560 330" role="img" aria-label="An athlete lifts a barbell beside a weekly workout calendar">
      <rect className="routine-room" x="12" y="12" width="536" height="306" rx="30" />
      <path className="routine-floor" d="M42 278H516" />
      <rect className="routine-calendar" x="335" y="63" width="155" height="150" rx="14" />
      <path className="routine-line" d="M358 88H465M365 51V72M461 51V72" />
      {[0, 1, 2].map(row => [0, 1, 2, 3].map(col => <rect key={`${row}-${col}`} className={`routine-day${(row + col) % 3 ? " completed" : ""}`} x={355 + col * 30} y={110 + row * 30} width="17" height="17" rx="5" />))}
      <path className="routine-rack" d="M68 274V161M305 274V161M60 274H86M288 274H314" />
      <g className="routine-athlete">
        <circle className="routine-skin" cx="190" cy="107" r="24" />
        <path className="routine-shirt" d="M165 142Q190 132 215 142L228 208H152Z" />
        <path className="routine-limb" d="M171 151L144 174L114 139M208 151L235 174L264 139" />
        <path className="routine-legs" d="M174 206L159 238L151 269M205 206L222 238L231 269" />
        <path className="routine-shoes" d="M151 269H135M231 269H248" />
        <g className="routine-barbell"><path className="routine-bar" d="M73 135H305" /><rect x="78" y="115" width="17" height="40" rx="4" /><rect x="284" y="115" width="17" height="40" rx="4" /><rect x="96" y="106" width="19" height="58" rx="5" /><rect x="264" y="106" width="19" height="58" rx="5" /></g>
      </g>
      <path className="routine-energy" d="M121 72L109 59M142 58L139 42M263 75L279 61" />
    </svg>
    <span className="routine-caption">A little progress. Every week.</span>
  </div>;
}
