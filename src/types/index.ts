export interface MempoolVin {
  txid: string;
  vout: number;
  is_coinbase?: boolean;
  prevout: {
    scriptpubkey_address?: string;
    scriptpubkey_type?: string;
    value: number;
  };
  sequence: number;
}

export interface MempoolVout {
  scriptpubkey_address?: string;
  scriptpubkey_type?: string;
  value: number;
}

export interface MempoolTx {
  txid: string;
  vin: MempoolVin[];
  vout: MempoolVout[];
  fee: number;
  size: number;
  weight: number;
  version: number;
  locktime: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
}

export interface MempoolOutspend {
  spent: boolean;
  txid?: string;
  vin?: number;
  status?: {
    confirmed: boolean;
    block_height?: number;
  };
}

export interface StoredTransaction {
  coordinates: { x: number; y: number };
  data: MempoolTx;
  outspends: MempoolOutspend[];
  name?: string;
  color?: string;
}

export interface StoredAddress {
  name?: string;
  description?: string;
  color?: string;
  isSelected: boolean;
  groupId?: string; // empty string = Default group
}

export interface AddressGroup {
  id: string; // empty string = Default group
  name: string;
  color?: string;
  addresses: string[];
}

export interface GlobalState {
  transactions: Record<string, StoredTransaction>;
  addresses: Record<string, StoredAddress>;
  groups: AddressGroup[];
  selectedTxid?: string;
  autoLayout: boolean;
}

export interface HandleDescriptor {
  id: string;
  label: string;
  amount: number; // in sats
  addresses: string[];
  txids: string[]; // txids to add when clicked
  vinIndices?: number[]; // for inputs
  voutIndices?: number[]; // for outputs
  isOpReturn?: boolean;
  isCoinbase?: boolean;
}
