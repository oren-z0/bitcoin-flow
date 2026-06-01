import { useGlobalState, type AddTransactionsOptions } from '../hooks/useGlobalState';

export const LIGHTNING_CHANNEL_URL =
  'https://mempool.space/lightning/channel/774506985784147968';

const LIGHTNING_CHANNEL_TXS = [
  {
    txid: '3164b5dc70657b666ca9063c8bd9632996814907e72c877cbdb75165d0f08097',
    name: 'Channel Open',
  },
  {
    txid: 'f9b48496a3b16693460a447a224b102d4fb3d38bb9473dc865fb5ce6e71761bd',
    name: 'Channel Close',
  },
  {
    txid: '4f05f612f02c6ed773b0eb270b7f8e22fbd5839c7c9d8fb95a198766f590d70d',
    name: 'Lightning Force Close',
  },
] as const;

const LIGHTNING_CHANNEL_ADDRESSES = [
  {
    address: 'bc1qzthf6zwqf5jweqmmqgtduyxqz8sr0jz7v67leh53ke6xgf9a8mxs3yq8dm',
    name: 'Lightning Anchor 1',
  },
  {
    address: 'bc1q39h2r2z5p2eykcka3qe6rpc8aekrzhyyutfq6s0jdm2dcmy8lycsnmuccv',
    name: 'Lightning Anchor 2',
  },
] as const;

const TIMELOCK_RECOVERY_TXS = [
  {
    txid: '8b1a59ba445220d70bb3a5bdc9dd44515f885509e9631fe409a024c483ed73b0',
    name: 'Initiate Transaction',
  },
  {
    txid: '526c3e7916d3d455ddd85ca520f31fca675ed7b97e4ed6e71e7090fe765b74a0',
    name: 'Recovery Transaction',
  },
] as const;

const TIMELOCK_RECOVERY_ADDRESSES = [
  {
    address: 'bc1qrcc6fzcegp33926aavfc06a9e5xkyrxc98sash',
    name: 'Alert Address',
  },
  {
    address: 'bc1qht9jx9l524xrl8lvzkucpm6ch9jjshyjkh0agl',
    name: 'Recovery Address',
  },
] as const;

function exampleLoadOptions(
  txs: ReadonlyArray<{ txid: string; name: string; description?: string }>,
  addresses: ReadonlyArray<{ address: string; name: string }>
): AddTransactionsOptions {
  return {
    transactionMeta: Object.fromEntries(
      txs.map(({ txid, name, description }) => [
        txid,
        { name, ...(description ? { description } : {}) },
      ])
    ),
    addressMeta: Object.fromEntries(
      addresses.map(({ address, name }) => [address, { name, isSelected: false }])
    ),
    fitViewAfterLayout: true,
  };
}

export async function loadLightningChannelExample(): Promise<void> {
  const { addTransactions } = useGlobalState.getState();
  await addTransactions(
    LIGHTNING_CHANNEL_TXS.map(t => t.txid),
    exampleLoadOptions(
      LIGHTNING_CHANNEL_TXS.map(t => ({
        ...t,
        description: LIGHTNING_CHANNEL_URL,
      })),
      LIGHTNING_CHANNEL_ADDRESSES
    )
  );
}

export async function loadTimelockRecoveryExample(): Promise<void> {
  const { addTransactions } = useGlobalState.getState();
  await addTransactions(
    TIMELOCK_RECOVERY_TXS.map(t => t.txid),
    exampleLoadOptions(TIMELOCK_RECOVERY_TXS, TIMELOCK_RECOVERY_ADDRESSES)
  );
}
