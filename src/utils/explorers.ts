export type ExplorerId = 'mempool' | 'blockstream' | 'learnmeabitcoin' | 'blockchair';

export const EXPLORERS: { id: ExplorerId; label: string }[] = [
  { id: 'mempool', label: 'Mempool.space' },
  { id: 'blockstream', label: 'Blockstream Explorer' },
  { id: 'learnmeabitcoin', label: 'Learn Me A Bitcoin' },
  { id: 'blockchair', label: 'Blockchair' },
];

export function getExplorerUrl(explorer: ExplorerId, type: 'tx' | 'address', id: string): string {
  switch (explorer) {
    case 'mempool':
      return type === 'tx'
        ? `https://mempool.space/tx/${id}`
        : `https://mempool.space/address/${id}`;
    case 'blockstream':
      return type === 'tx'
        ? `https://blockstream.info/tx/${id}`
        : `https://blockstream.info/address/${id}`;
    case 'learnmeabitcoin':
      return type === 'tx'
        ? `https://learnmeabitcoin.com/explorer/tx/${id}`
        : `https://learnmeabitcoin.com/explorer/address/${id}`;
    case 'blockchair':
      return type === 'tx'
        ? `https://blockchair.com/bitcoin/transaction/${id}`
        : `https://blockchair.com/bitcoin/address/${id}`;
  }
}
