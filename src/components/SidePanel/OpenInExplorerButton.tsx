import { useEffect, useRef, useState } from 'react';
import { EXPLORERS, getExplorerUrl } from '../../utils/explorers';

interface Props {
  type: 'tx' | 'address';
  id: string;
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
        className="w-full text-xs bg-blue-700 hover:bg-blue-600 text-white py-1.5 rounded cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        Open in...
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
