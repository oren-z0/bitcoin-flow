import type { LoadProgress } from '../utils/loadSlimState';

export default function StateLoadProgress({ progress }: { progress: LoadProgress }) {
  if (!progress) return null;

  const remaining = progress.total - progress.done;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 border border-gray-600 rounded-lg px-6 py-4 text-center shadow-xl">
        <div className="text-white text-sm font-medium mb-1">Loading transactions…</div>
        <div className="text-gray-400 text-xs">
          {remaining} of {progress.total} remaining
        </div>
        <div className="mt-3 w-48 bg-gray-700 rounded-full h-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
