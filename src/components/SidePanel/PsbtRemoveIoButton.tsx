function TrashIcon() {
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
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

interface Props {
  label: string;
  disabled?: boolean;
  disabledTitle?: string;
  onRemove: () => void;
}

export default function PsbtRemoveIoButton({
  label,
  disabled,
  disabledTitle,
  onRemove,
}: Props) {
  return (
    <button
      type="button"
      className="absolute top-2 right-2 p-0.5 text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      title={disabled ? disabledTitle : label}
      aria-label={label}
      disabled={disabled}
      onClick={onRemove}
    >
      <TrashIcon />
    </button>
  );
}
