# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bitcoin Flow is a React app that visualizes Bitcoin transactions as a flow graph. The full specification is in `SPEC.md` — read it before implementing anything.

## Tech Stack

- **React** with **TypeScript**
- **React Flow** (free features only — no paid features)
- **Tailwind CSS** for styling
- **elkjs** for auto-layout Y-coordinate calculation
- **mempool.space API** for transaction data (including outspends)
- **localStorage** for persisting global state

## Commands

Once the project is scaffolded (e.g. with Vite):

```bash
npm install        # Install dependencies
npm run dev        # Start dev server
npm run build      # Build for production
npm run lint       # Lint
npm run test       # Run tests (if configured)
```

## Architecture

### Global State (localStorage)

```ts
{
  transactions: Record<txid, {
    coordinates: { x: number, y: number },
    data: MempoolTransaction,      // from mempool.space API
    outspends: MempoolOutspend[],  // from mempool.space API
    name?: string,
    color?: string,
  }>,
  addresses: Record<address, {
    name?: string,
    color?: string,
    isSelected: boolean,
  }>,
  selectedTxid?: string,
}
```

Keep a derived `selectedAddresses: Set<string>` in memory (not in localStorage) for performance — rebuild it on load from the `addresses` map.

A global `autoLayout: boolean` controls whether the layout is recalculated when transactions are added/removed.

### mempool.space API

- Fetch transaction: `GET https://mempool.space/api/tx/{txid}`
- Fetch outspends: `GET https://mempool.space/api/tx/{txid}/outspends`
- Fetch address transactions: `GET https://mempool.space/api/address/{address}/txs`
- WebSocket for new blocks: `wss://mempool.space/api/v1/ws` — subscribe to new blocks to refresh unconfirmed transactions and unspent outspends.

### Key Architectural Decisions

**Node handles:** Inputs on the left, outputs on the right. At most 4 handles per side — when there are more, group them using the collapsing rules in the spec (handle input/output grouping logic is complex — read SPEC.md carefully).

**Edge width:** Log-scale between 2px–8px based on BTC amount relative to min/max across all edges.

**Auto-Layout:**
- X: sort transactions by block-height (then txid), space evenly, center around zero.
- Y: use **elkjs** (not React Flow's built-in layout, which requires a paid plan).
- Animate node transitions with a duration of several seconds.

**Adding a transaction:** Calculate X as average of neighbors in sorted order, Y as the current viewport center. Then apply auto-layout if enabled. Finally, focus the view on the new node.

### Component Structure (suggested)

- `FlowCanvas` — main React Flow canvas with nodes and edges
- `TransactionNode` — custom node component with input/output handles and labels
- `SidePanel` — right sidebar with Transactions/Addresses/Settings tabs and transaction detail view
- `useGlobalState` — hook managing localStorage persistence, `selectedAddresses` set, and state mutations
- `useMempoolApi` — hook for mempool.space API calls and WebSocket connection
- `autoLayout` — utility for elkjs-based layout calculation
