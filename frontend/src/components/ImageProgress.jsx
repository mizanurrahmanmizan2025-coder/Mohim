import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Download, ExternalLink, ImageIcon } from 'lucide-react';

const ratio = (aspect = '16:9') => aspect.replace(':', ' / ');

async function downloadImage(url, i) {
  try {
    const blob = await (await fetch(url)).blob();
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `ai-image-${i + 1}.${ext}` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** Animated placeholder with percentage + stage label while an image renders. */
function ProgressCard({ progress, aspect }) {
  const pct = Math.max(2, Math.min(100, progress?.percent ?? 2));
  return (
    <div className="relative overflow-hidden rounded-2xl bg-surface-card dark:bg-surface-darkcard" style={{ aspectRatio: ratio(aspect) }}>
      {/* moving gradient "canvas" */}
      <div className="canvas-shimmer absolute inset-0 opacity-70" />
      <motion.div
        className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-violet-500/20 to-pink-500/20 blur-2xl"
        animate={{ opacity: [0.4, 0.8, 0.4], scale: [1, 1.05, 1] }}
        transition={{ duration: 3, repeat: Infinity }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
        <ImageIcon size={28} className="text-gray-400 dark:text-gray-500" />
        <div className="text-sm font-medium">{progress?.label || 'Preparing canvas'}…</div>
        <div className="h-1.5 w-2/3 max-w-[260px] overflow-hidden rounded-full bg-gray-300/60 dark:bg-gray-700">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-pink-500 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs tabular-nums text-gray-500">
          {pct}%{progress?.provider ? ` · ${progress.provider}` : ''}
        </div>
      </div>
    </div>
  );
}

/** One generated image: progress card → fades into the real image once it has loaded. */
export function GeneratedImage({ src, index, progress, aspect }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [creep, setCreep] = useState(progress?.percent || 92);

  // image URL is known but still downloading/rendering (e.g. Pollinations) → keep the bar moving
  useEffect(() => {
    if (!src || loaded) return undefined;
    const t = setInterval(() => setCreep((p) => Math.min(99, p + Math.max(0.3, (99 - p) * 0.08))), 700);
    return () => clearInterval(t);
  }, [src, loaded]);

  if (progress?.error && !src) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl bg-red-50 p-6 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300" style={{ aspectRatio: ratio(aspect) }}>
        <AlertTriangle size={16} /> This image couldn&apos;t be generated
      </div>
    );
  }
  if (!src) return <ProgressCard progress={progress} aspect={aspect} />;

  return (
    <div className="group relative overflow-hidden rounded-2xl bg-surface-card dark:bg-surface-darkcard">
      {!loaded && !failed && (
        <ProgressCard aspect={aspect} progress={{ percent: Math.round(creep), label: progress?.percent >= 100 ? 'Loading image' : progress?.label || 'Rendering image', provider: progress?.provider }} />
      )}
      {failed && (
        <div className="flex items-center justify-center p-8 text-sm text-gray-500" style={{ aspectRatio: ratio(aspect) }}>
          Image failed to load — try again.
        </div>
      )}
      <a href={src} target="_blank" rel="noopener noreferrer">
        <motion.img
          src={src}
          alt={`Generated ${index + 1}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          initial={false}
          animate={loaded ? { opacity: 1, filter: 'blur(0px)', scale: 1 } : { opacity: 0, filter: 'blur(16px)', scale: 1.02 }}
          transition={{ duration: 0.7 }}
          className={`w-full object-cover ${loaded ? '' : 'absolute inset-0'}`}
        />
      </a>
      {loaded && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button onClick={() => downloadImage(src, index)} className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80" title="Download">
            <Download size={16} />
          </button>
          <a href={src} target="_blank" rel="noopener noreferrer" className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80" title="Open full size">
            <ExternalLink size={16} />
          </a>
        </div>
      )}
    </div>
  );
}

/** Grid of images for a message — shows placeholders for every planned image. */
export default function ImageGrid({ images = [], plan, progress = {} }) {
  const count = Math.max(plan?.count || 0, images.length);
  if (!count) return null;
  const aspect = plan?.aspect || '16:9';
  return (
    <div className={`mt-3 grid gap-3 ${count > 1 ? 'sm:grid-cols-2' : 'max-w-2xl'}`}>
      {Array.from({ length: count }, (_, i) => (
        <GeneratedImage key={i} index={i} src={images[i]} progress={progress[i]} aspect={aspect} />
      ))}
    </div>
  );
}
