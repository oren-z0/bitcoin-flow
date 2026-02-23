import React, { useRef, useState } from 'react';
import Papa from 'papaparse';
import { useGlobalState } from '../../hooks/useGlobalState';
import { truncateAddress } from '../../utils/formatting';
import { getEffectiveName, getEffectiveColor } from '../../utils/addressDisplay';
import { EMOJI_PALETTE } from '../../utils/emoji';
import { deriveAddressesFromXpub, type XpubAddressFormat } from '../../utils/xpub';

interface Props {
  onOpenAddressDetail: (address: string) => void;
  onOpenGroupDetail: (groupId: string) => void;
}

export default function AddressesTab({ onOpenAddressDetail, onOpenGroupDetail }: Props) {
  const { addresses, groups, groupMap, updateAddress, removeAddress, addGroup, addAddressesToGroup, updateGroup, removeGroup } = useGlobalState();
  const colorInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [addrInput, setAddrInput] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');

  // Per-group collapsed state (session only, default open)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Inline group name editing
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');

  // "Add Group" flow
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [showGroupEmoji, setShowGroupEmoji] = useState(false);
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const newGroupCursorRef = useRef(0);

  // "Add Group from Extended Public Key" flow
  const [addingFromXpub, setAddingFromXpub] = useState(false);
  const [xpubGroupName, setXpubGroupName] = useState('');
  const [xpubInput, setXpubInput] = useState('');
  const [xpubFormat, setXpubFormat] = useState<XpubAddressFormat>('p2wpkh');
  const [xpubError, setXpubError] = useState('');
  const [xpubLoading, setXpubLoading] = useState(false);

  const handleCreateFromXpub = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = xpubGroupName.trim();
    const input = xpubInput.trim();
    if (!name || !input) return;
    setXpubLoading(true);
    setXpubError('');
    try {
      const derived = deriveAddressesFromXpub(input, xpubFormat);
      const extKey = input.slice(0, input.indexOf('/'));
      const groupId = addGroup(name);
      addAddressesToGroup(
        derived.map(({ address, path }) => ({
          address,
          description: `${extKey}/${path.slice(2)}`, // remove "m/" prefix
        })),
        groupId
      );
      setAddingFromXpub(false);
      setXpubGroupName('');
      setXpubInput('');
      setXpubError('');
      if (derived.length > 0) onOpenGroupDetail(groupId);
    } catch (err) {
      setXpubError(err instanceof Error ? err.message : 'Failed to derive addresses');
    } finally {
      setXpubLoading(false);
    }
  };

  const handleAddAddress = (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const addr = addrInput.trim();
    if (!addr) return;
    // Ensure selectedGroupId still exists
    const groupExists = groups.some(g => g.id === selectedGroupId);
    const groupId = groupExists ? selectedGroupId : '';
    if (!addresses[addr]) {
      updateAddress(addr, { isSelected: false, groupId });
    }
    setAddrInput('');
    onOpenAddressDetail(addr);
  };

  const handleDeselectAll = () => {
    Object.keys(addresses).forEach(addr => {
      if (addresses[addr].isSelected) {
        updateAddress(addr, { isSelected: false });
      }
    });
  };

  const handleStartEditGroup = (groupId: string, currentName: string) => {
    setEditingGroupId(groupId);
    setEditingGroupName(currentName);
  };

  const handleSaveGroupName = () => {
    if (editingGroupId !== null && editingGroupName.trim()) {
      updateGroup(editingGroupId, { name: editingGroupName.trim() });
    }
    setEditingGroupId(null);
    setEditingGroupName('');
  };

  const handleAddGroup = (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    addGroup(name);
    setAddingGroup(false);
    setNewGroupName('');
    setShowGroupEmoji(false);
  };

  const insertGroupEmoji = (emoji: string) => {
    const pos = newGroupCursorRef.current;
    const next = newGroupName.slice(0, pos) + emoji + newGroupName.slice(pos);
    setNewGroupName(next);
    setShowGroupEmoji(false);
    requestAnimationFrame(() => {
      newGroupInputRef.current?.focus();
      const newPos = pos + emoji.length;
      newGroupInputRef.current?.setSelectionRange(newPos, newPos);
      newGroupCursorRef.current = newPos;
    });
  };

  const handleDownloadCsv = () => {
    const rows = Object.entries(addresses).map(([addr, data]) => {
      const groupId = data.groupId ?? '';
      const group = groupMap[groupId];
      const groupName = groupId === '' ? '' : (group?.name ?? '');
      let color = '';
      if (data.color) {
        color = data.color;
      } else if (groupId !== '' && group?.color) {
        color = `${group.color} (group)`;
      }
      return { address: addr, name: data.name || '', description: data.description || '', color, groupName };
    });
    const csv = Papa.unparse(rows, { header: true });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bitcoin-flow-addresses.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (csvInputRef.current) csvInputRef.current.value = '';
    Papa.parse<{ address: string; name?: string; description?: string; color?: string; groupName?: string }>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const { addresses: currentAddrs, ensureGroup: eg, updateAddress: ua, updateGroup: ug } = useGlobalState.getState();

        // Ensure all non-default groups exist (id = groupName)
        const uniqueGroupNames = [...new Set(
          results.data.map(r => r.groupName?.trim() ?? '').filter(Boolean)
        )];
        for (const gn of uniqueGroupNames) eg(gn, gn);

        const groupColors: Record<string, string> = {};

        results.data.forEach(row => {
          const addr = row.address?.trim();
          if (!addr) return;
          const groupName = row.groupName?.trim() ?? '';
          const groupId = groupName; // empty string = default group
          const colorRaw = row.color?.trim() ?? '';
          let addrColor: string | undefined;
          if (colorRaw.endsWith(' (group)')) {
            const c = colorRaw.slice(0, -(` (group)`).length).trim();
            if (groupId !== '' && c) groupColors[groupId] = c;
          } else if (colorRaw) {
            addrColor = colorRaw;
          }
          const isNew = !currentAddrs[addr];
          const patch: Parameters<typeof ua>[1] = { isSelected: false };
          if (isNew) patch.groupId = groupId;
          if (row.name?.trim()) patch.name = row.name.trim();
          if (row.description?.trim()) patch.description = row.description.trim();
          if (addrColor) patch.color = addrColor;
          ua(addr, patch);
        });

        for (const [gid, color] of Object.entries(groupColors)) {
          ug(gid, { color });
        }
      },
    });
  };

  const anySelected = Object.values(addresses).some(d => d.isSelected);

  const trimmedInput = addrInput.trim();
  const existingAddr = trimmedInput ? addresses[trimmedInput] : undefined;
  const existingGroupName = existingAddr
    ? (groups.find(g => g.id === (existingAddr.groupId ?? ''))?.name ?? 'Default')
    : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Add address form */}
      <div className="p-3 border-b border-gray-700 space-y-2">
        <form onSubmit={handleAddAddress} className="flex gap-2">
          <input
            className="flex-1 bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500"
            placeholder="Enter address..."
            value={addrInput}
            onChange={e => setAddrInput(e.target.value)}
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={!trimmedInput || !!existingAddr}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs px-3 py-1 rounded"
          >
            Add
          </button>
        </form>

        {existingGroupName && (
          <div className="text-xs text-yellow-500">
            Already in group &quot;{existingGroupName}&quot;
          </div>
        )}

        {/* Group selector */}
        <select
          className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-blue-500"
          value={selectedGroupId}
          onChange={e => setSelectedGroupId(e.target.value)}
        >
          {groups.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>

        {/* Add Group */}
        {addingGroup ? (
          <form onSubmit={handleAddGroup} className="flex gap-2">
            <div className="relative flex-1 flex items-center bg-gray-700 rounded border border-gray-600 focus-within:border-blue-500">
              <input
                ref={newGroupInputRef}
                autoFocus
                className="flex-1 min-w-0 bg-transparent text-white text-xs px-2 py-1 focus:outline-none placeholder-gray-500"
                placeholder="Group name..."
                value={newGroupName}
                onChange={e => {
                  setNewGroupName(e.target.value);
                  newGroupCursorRef.current = e.target.selectionStart ?? 0;
                }}
                onSelect={() => { newGroupCursorRef.current = newGroupInputRef.current?.selectionStart ?? 0; }}
                onKeyDown={e => { if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName(''); setShowGroupEmoji(false); } }}
              />
              <button
                type="button"
                className="shrink-0 px-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded-r transition-colors"
                onClick={() => setShowGroupEmoji(prev => !prev)}
                title="Insert emoji"
              >
                <span className="text-sm" aria-hidden>😀</span>
              </button>
              {showGroupEmoji && (
                <>
                  <div className="fixed inset-0 z-10" aria-hidden onClick={() => setShowGroupEmoji(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 p-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                    {EMOJI_PALETTE.map((emoji, i) => (
                      <button
                        key={i}
                        type="button"
                        className="w-7 h-7 flex items-center justify-center text-lg hover:bg-gray-600 rounded transition-colors"
                        onClick={() => insertGroupEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              type="submit"
              disabled={!newGroupName.trim()}
              className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs px-2 py-1 rounded"
            >
              Create
            </button>
            <button
              type="button"
              className="text-gray-400 hover:text-white text-xs leading-none"
              title="Cancel"
              onClick={() => { setAddingGroup(false); setNewGroupName(''); setShowGroupEmoji(false); }}
            >
              ✕
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="text-xs text-blue-400 hover:text-blue-300 underline"
            onClick={() => setAddingGroup(true)}
          >
            + Add Empty Group
          </button>
        )}

        {/* Add Group from Extended Public Key */}
        {addingFromXpub ? (
          <form onSubmit={handleCreateFromXpub} className="space-y-2 border border-gray-600 rounded p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-300 font-medium">Add Group from xpub</span>
              <button
                type="button"
                className="text-gray-400 hover:text-white text-xs leading-none"
                title="Cancel"
                onClick={() => { setAddingFromXpub(false); setXpubGroupName(''); setXpubInput(''); setXpubError(''); }}
              >
                ✕
              </button>
            </div>
            <input
              autoFocus
              className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500"
              placeholder="Group name..."
              value={xpubGroupName}
              onChange={e => setXpubGroupName(e.target.value)}
            />
            <input
              className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500 font-mono"
              placeholder="xpub.../0/{0...10}"
              value={xpubInput}
              onChange={e => setXpubInput(e.target.value)}
              spellCheck={false}
            />
            <select
              className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-blue-500"
              value={xpubFormat}
              onChange={e => setXpubFormat(e.target.value as XpubAddressFormat)}
            >
              <option value="p2pkh">Legacy P2PKH (i.e. 1...)</option>
              <option value="p2sh-p2wpkh">Nested Segwit (i.e. 3...)</option>
              <option value="p2wpkh">Native Segwit (i.e. bc1q...)</option>
              <option value="p2tr">Taproot (i.e. bc1p...)</option>
            </select>
            {xpubError && (
              <div className="text-red-400 text-xs">{xpubError}</div>
            )}
            <button
              type="submit"
              disabled={!xpubGroupName.trim() || !xpubInput.trim() || xpubLoading}
              className="w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs py-1 rounded"
            >
              {xpubLoading ? 'Deriving addresses...' : 'Create'}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="text-xs text-blue-400 hover:text-blue-300 underline"
            onClick={() => setAddingFromXpub(true)}
          >
            + Add Group from Extended Public Key
          </button>
        )}

        {/* CSV buttons */}
        <div className="flex gap-2">
          <button
            className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 py-1 rounded"
            onClick={() => csvInputRef.current?.click()}
          >
            Load CSV
          </button>
          <button
            className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 py-1 rounded"
            disabled={Object.keys(addresses).length === 0}
            onClick={handleDownloadCsv}
          >
            Download CSV
          </button>
        </div>
        <div className="text-xs text-gray-500">
          CSV format: address, name, description, color, group-name
        </div>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleUploadCsv}
        />
      </div>

      {/* Deselect All */}
      {anySelected && (
        <div className="px-3 py-2 border-b border-gray-700">
          <button className="text-xs text-gray-400 hover:text-white" onClick={handleDeselectAll}>
            Deselect All
          </button>
        </div>
      )}

      {/* Groups list */}
      <div className="flex-1 overflow-y-auto">
        {groups.map(group => {
          const isCollapsed = collapsed[group.id] ?? false;
          const isDefault = group.id === '';
          const isEditing = editingGroupId === group.id;

          const groupAddrs = group.addresses.filter(a => addresses[a]);
          const anyGroupSelected = groupAddrs.some(a => addresses[a]?.isSelected);

          return (
            <div key={group.id} className="border-b border-gray-700">
              {/* Group header */}
              <div className="flex items-center gap-1 px-3 py-2 bg-gray-750 select-none">
                {/* Collapse toggle */}
                <button
                  className="text-gray-400 hover:text-white w-4 flex-shrink-0 text-center"
                  onClick={() => setCollapsed(prev => ({ ...prev, [group.id]: !isCollapsed }))}
                >
                  {isCollapsed ? '▶' : '▼'}
                </button>

                {/* Group name (or inline edit) */}
                {isEditing ? (
                  <input
                    autoFocus
                    className="flex-1 bg-gray-600 text-white text-xs rounded px-1 py-0.5 border border-blue-500 focus:outline-none"
                    value={editingGroupName}
                    onChange={e => setEditingGroupName(e.target.value)}
                    onBlur={handleSaveGroupName}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.currentTarget.blur(); }
                      if (e.key === 'Escape') { setEditingGroupId(null); }
                    }}
                  />
                ) : (
                  <span className="flex-1 text-xs font-semibold text-gray-300 truncate">
                    {group.name}
                    <span className="ml-1 text-gray-500 font-normal">({group.addresses.length})</span>
                  </span>
                )}

                {/* Select All / Deselect All */}
                {!isEditing && groupAddrs.length > 0 && (
                  <button
                    className="text-xs text-gray-400 hover:text-white flex-shrink-0"
                    onClick={() => groupAddrs.forEach(a => updateAddress(a, { isSelected: !anyGroupSelected }))}
                  >
                    {anyGroupSelected ? 'Deselect All' : 'Select All'}
                  </button>
                )}

                {/* Magnifying glass for Default group (no other right-side actions) */}
                {isDefault && !isEditing && (
                  <button
                    className="text-gray-400 hover:text-white flex-shrink-0 text-xs leading-none"
                    title="Browse group transactions"
                    onClick={() => onOpenGroupDetail(group.id)}
                  >
                    🔍
                  </button>
                )}

                {/* Non-default group actions */}
                {!isDefault && !isEditing && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Magnifying glass */}
                    <button
                      className="text-gray-400 hover:text-white text-xs leading-none"
                      title="Browse group transactions"
                      onClick={() => onOpenGroupDetail(group.id)}
                    >
                      🔍
                    </button>
                    {/* Color picker */}
                    <button
                      className="w-4 h-4 rounded-full border flex-shrink-0 focus:outline-none"
                      style={{
                        background: group.color || 'transparent',
                        borderColor: group.color || '#6b7280',
                        borderStyle: group.color ? 'solid' : 'dashed',
                      }}
                      title="Group color"
                      onClick={() => colorInputRefs.current[group.id]?.click()}
                    />
                    <input
                      ref={el => { colorInputRefs.current[group.id] = el; }}
                      type="color"
                      className="sr-only"
                      value={group.color || '#6b7280'}
                      onChange={e => updateGroup(group.id, { color: e.target.value })}
                    />
                    {group.color && (
                      <button
                        className="text-gray-500 hover:text-white text-xs leading-none"
                        title="Clear color"
                        onClick={() => updateGroup(group.id, { color: undefined })}
                      >
                        ✕
                      </button>
                    )}
                    <button
                      className="text-gray-400 hover:text-white text-xs px-1"
                      title="Rename group"
                      onClick={() => handleStartEditGroup(group.id, group.name)}
                    >
                      ✏️
                    </button>
                    <button
                      className="text-gray-400 hover:text-red-400 text-xs px-1"
                      title="Delete group and all its addresses"
                      onClick={() => {
                        if (confirm(`Delete group "${group.name}" and all ${group.addresses.length} address(es)?`)) {
                          removeGroup(group.id);
                        }
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>

              {/* Address rows */}
              {!isCollapsed && (
                <div>
                  {group.addresses.length === 0 ? (
                    <div className="text-xs text-gray-600 px-8 py-2">No addresses.</div>
                  ) : (
                    group.addresses.map(addr => {
                      const data = addresses[addr];
                      if (!data) return null;
                      return (
                        <div
                          key={addr}
                          className="flex items-center gap-2 px-3 py-2 border-t border-gray-700 hover:bg-gray-700"
                        >
                          <input
                            type="checkbox"
                            checked={data.isSelected}
                            onChange={e => updateAddress(addr, { isSelected: e.target.checked })}
                            className="cursor-pointer accent-blue-500 flex-shrink-0"
                          />
                          <div
                            className="flex-1 cursor-pointer min-w-0"
                            onClick={() => onOpenAddressDetail(addr)}
                          >
                            {(() => {
                              const effectiveName = getEffectiveName(addr, data, groupMap);
                              const effectiveColor = getEffectiveColor(data, groupMap);
                              return (
                                <>
                                  <div className="text-sm truncate" style={{ color: effectiveColor || '#e5e7eb' }}>
                                    {effectiveName || truncateAddress(addr)}
                                  </div>
                                  {effectiveName && (
                                    <div className="text-xs text-gray-500 font-mono truncate">{truncateAddress(addr)}</div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                          <button
                            className="text-gray-600 hover:text-red-400 text-xs flex-shrink-0"
                            title="Delete address"
                            onClick={() => removeAddress(addr)}
                          >
                            🗑️
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

      </div>
    </div>
  );
}
