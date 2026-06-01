import { useGlobalState } from '../hooks/useGlobalState';

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

export async function loadLightningChannelExample(): Promise<void> {
  const { addTransactions, updateTransaction, updateAddress } = useGlobalState.getState();

  await addTransactions(LIGHTNING_CHANNEL_TXS.map(t => t.txid));

  for (const { txid, name } of LIGHTNING_CHANNEL_TXS) {
    updateTransaction(txid, {
      name,
      description: LIGHTNING_CHANNEL_URL,
    });
  }

  for (const { address, name } of LIGHTNING_CHANNEL_ADDRESSES) {
    updateAddress(address, { name, isSelected: false });
  }
}
