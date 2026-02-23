import { useEffect, useState } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import TransactionDetail from './TransactionDetail';
import TransactionsTab from './TransactionsTab';
import AddressesTab from './AddressesTab';
import AddressDetail from './AddressDetail';
import GroupDetail from './GroupDetail';
import SettingsTab from './SettingsTab';

type Tab = 'transactions' | 'addresses' | 'settings';

export default function SidePanel() {
  const { selectedTxid } = useGlobalState();
  const [tab, setTab] = useState<Tab>('transactions');
  const [addressDetailView, setAddressDetailView] = useState<string | null>(null);
  const [groupDetailView, setGroupDetailView] = useState<string | null>(null);

  const handleOpenAddressDetail = (address: string) => {
    setTab('addresses');
    setGroupDetailView(null);
    setAddressDetailView(address);
  };

  const handleOpenGroupDetail = (groupId: string) => {
    setTab('addresses');
    setAddressDetailView(null);
    setGroupDetailView(groupId);
  };

  // Listen for custom events from node clicks
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { address: string };
      handleOpenAddressDetail(detail.address);
    };
    window.addEventListener('open-address-detail', handler);
    return () => window.removeEventListener('open-address-detail', handler);
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'transactions', label: 'Transactions' },
    { id: 'addresses', label: 'Addresses' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div
      className="flex flex-col h-full bg-gray-800 border-l border-gray-700 text-gray-200"
      style={{ width: 336 }}
    >
      {selectedTxid ? (
        <TransactionDetail onOpenAddressDetail={handleOpenAddressDetail} />
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex border-b border-gray-700 shrink-0">
            {tabs.map(t => (
              <button
                key={t.id}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? 'text-white border-b-2 border-blue-500'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                onClick={() => {
                  setTab(t.id);
                  if (t.id !== 'addresses') {
                    setAddressDetailView(null);
                    setGroupDetailView(null);
                  }
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {tab === 'transactions' && <TransactionsTab />}
            {tab === 'addresses' && (
              addressDetailView ? (
                <AddressDetail
                  address={addressDetailView}
                  onBack={() => setAddressDetailView(null)}
                  onOpenAddressDetail={handleOpenAddressDetail}
                />
              ) : groupDetailView !== null ? (
                <GroupDetail
                  groupId={groupDetailView}
                  onBack={() => setGroupDetailView(null)}
                />
              ) : (
                <AddressesTab
                  onOpenAddressDetail={handleOpenAddressDetail}
                  onOpenGroupDetail={handleOpenGroupDetail}
                />
              )
            )}
            {tab === 'settings' && <SettingsTab />}
          </div>
        </>
      )}
    </div>
  );
}
