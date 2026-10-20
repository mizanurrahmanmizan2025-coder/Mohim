import { useEffect, useRef, useState } from 'react';

/**
 * Smoothly reveals `text` as it grows (typewriter effect).
 * - animate=false (history messages) → shows full text immediately.
 * - Speeds up automatically when far behind, so big chunks never lag.
 * - If text is replaced (provider switched mid-answer), restarts from the new text.
 */
export default function useTypewriter(text = '', animate = false) {
  const [shown, setShown] = useState(animate ? '' : text);
  const shownRef = useRef(shown);
  const animateRef = useRef(animate);

  useEffect(() => {
    if (!animateRef.current) {
      shownRef.current = text;
      setShown(text);
      return undefined;
    }
    if (!text.startsWith(shownRef.current)) {
      shownRef.current = '';
      setShown('');
    }
    let raf;
    let last = 0;
    const tick = (now) => {
      const cur = shownRef.current;
      if (cur.length >= text.length) return;
      if (now - last < 28) { raf = requestAnimationFrame(tick); return; } // ~35 fps keeps markdown cheap
      last = now;
      const remaining = text.length - cur.length;
      const step = Math.max(3, Math.ceil(remaining / 10));
      shownRef.current = text.slice(0, cur.length + step);
      setShown(shownRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  return shown;
}
