/** Run async refresh jobs with limited concurrency to avoid main-thread stalls on mobile. */
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let index = 0;

  const runWorker = async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}
