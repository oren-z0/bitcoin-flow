import { useEffect, useRef, useState } from 'react';
import { EXPLORERS, getExplorerUrl } from '../../utils/explorers';

interface Props {
  type: 'tx' | 'address';
  id: string;
}

function ExternalLinkIcon() {
  return (
    <svg
      className="shrink-0"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function OpenInExplorerButton({ type, id }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="w-full flex items-center justify-center gap-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white py-1.5 rounded cursor-pointer"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ExternalLinkIcon />
        <span>Open in...</span>
        <ChevronDownIcon open={open} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-700 border border-gray-600 rounded shadow-lg overflow-hidden z-10">
          {EXPLORERS.map(explorer => (
            <button
              key={explorer.id}
              type="button"
              className="w-full text-left text-xs px-3 py-1.5 hover:bg-gray-600 text-gray-200 cursor-pointer"
              onClick={() => {
                window.open(getExplorerUrl(explorer.id, type, id), '_blank', 'noopener,noreferrer');
                setOpen(false);
              }}
            >
              {explorer.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
