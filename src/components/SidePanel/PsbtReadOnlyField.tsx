import { useGlobalState } from '../../hooks/useGlobalState';

interface Props {
  label: string;
  value: string;
  successMessage?: string;
}

export default function PsbtReadOnlyField({
  label,
  value,
  successMessage = 'Copied to clipboard',
}: Props) {
  const handleCopy = () => {
    const { addSuccess, addError } = useGlobalState.getState();
    navigator.clipboard.writeText(value).then(() => {
      addSuccess(successMessage);
    }).catch(() => {
      addError('Could not copy to clipboard');
    });
  };

  return (
    <div>
      <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
      <div
        className="text-[11px] font-mono text-gray-300 break-all cursor-pointer hover:text-white"
        title="Click to copy"
        onClick={handleCopy}
      >
        {value}
      </div>
    </div>
  );
}
