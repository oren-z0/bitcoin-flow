interface Props {
  count: number;
  index: number;
  onMove: (direction: 'up' | 'down') => void;
}

const arrowClass =
  'px-1 py-0.5 text-[10px] text-gray-400 hover:text-white hover:bg-gray-600 rounded cursor-pointer leading-none';

export default function PsbtMoveControls({ count, index, onMove }: Props) {
  if (count <= 1) return null;

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <span className="text-[10px] text-gray-500">Move</span>
      {index > 0 && (
        <button
          type="button"
          className={arrowClass}
          onClick={() => onMove('up')}
          aria-label="Move up"
          title="Move up"
        >
          ↑
        </button>
      )}
      {index < count - 1 && (
        <button
          type="button"
          className={arrowClass}
          onClick={() => onMove('down')}
          aria-label="Move down"
          title="Move down"
        >
          ↓
        </button>
      )}
    </div>
  );
}
