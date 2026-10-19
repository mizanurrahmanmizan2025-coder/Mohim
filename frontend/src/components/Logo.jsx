export function Sparkle({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="sparkle-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4285f4" />
          <stop offset=".5" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path fill="url(#sparkle-g)" d="M32 2c2 16 14 28 30 30-16 2-28 14-30 30-2-16-14-28-30-30C18 30 30 18 32 2z" />
    </svg>
  );
}

export default function Logo() {
  return (
    <div className="flex items-center gap-2">
      <Sparkle className="h-6 w-6" />
      <span className="text-lg font-semibold tracking-tight">Custom AI Suite</span>
    </div>
  );
}
