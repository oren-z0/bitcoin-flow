import ELK from 'elkjs/lib/elk.bundled.js';
import type { StoredTransaction } from '../types';
import { computeInputHandles, computeOutputHandles } from './handleGrouping';
import { sortTxids } from './sorting';

const elk = new ELK();
const NODE_GAP = 400;
const NODE_WIDTH = 260;
const NODE_HEIGHT = 150;
const Y_SPREAD = 2.5; // Multiplier applied to ELK's Y positions to increase vertical spread

export async function computeLayout(
  transactions: Record<string, StoredTransaction>
): Promise<Record<string, { x: number; y: number }>> {
  const sorted = sortTxids(transactions);
  const n = sorted.length;

  if (n === 0) return {};

  // Compute X positions: evenly spaced, centered around 0
  const xPositions: Record<string, number> = {};
  const totalWidth = (n - 1) * NODE_GAP;
  const startX = -totalWidth / 2;
  for (let i = 0; i < n; i++) {
    xPositions[sorted[i]] = startX + i * NODE_GAP;
  }

  // Build ELK nodes. We supply our pre-computed X so the INTERACTIVE
  // layering strategy groups nodes with the same X into the same ELK layer.
  // port.index 0 = topmost port in ELK's RIGHT-direction layout.
  const loadedTxids = new Set(Object.keys(transactions));

  const elkNodes = sorted.map(txid => {
    const tx = transactions[txid];
    const inputHandles = computeInputHandles(tx.data.vin, {}, {}, loadedTxids);
    const outputHandles = computeOutputHandles(tx.data.vout, tx.outspends, {}, {}, loadedTxids);

    const ports = [
      ...inputHandles.map((h, i) => ({
        id: `${txid}::${h.id}`,
        properties: {
          'port.side': 'WEST',
          'port.index': String(i),
        },
      })),
      ...outputHandles.map((h, i) => ({
        id: `${txid}::${h.id}`,
        properties: {
          'port.side': 'EAST',
          'port.index': String(i),
        },
      })),
    ];

    const estimatedHeight = Math.max(
      NODE_HEIGHT,
      Math.max(inputHandles.length, outputHandles.length) * 35 + 60
    );

    return {
      id: txid,
      width: NODE_WIDTH,
      height: estimatedHeight,
      x: xPositions[txid],  // INTERACTIVE layering reads this to assign layers
      y: 0,
      ports,
      properties: {
        'portConstraints': 'FIXED_ORDER',
      },
    };
  });

  // Build edges referencing port IDs so ELK respects handle ordering
  const elkEdges: { id: string; sources: string[]; targets: string[] }[] = [];
  for (const txid of sorted) {
    const tx = transactions[txid];
    const outputHandles = computeOutputHandles(tx.data.vout, tx.outspends, {}, {}, loadedTxids);

    tx.outspends.forEach((outspend, voutIdx) => {
      if (!outspend.spent || !outspend.txid || !transactions[outspend.txid]) return;
      const spendingTxid = outspend.txid;
      const vinIdx = outspend.vin ?? 0;

      const spendingTx = transactions[spendingTxid];
      const inputHandles = computeInputHandles(spendingTx.data.vin, {}, {}, loadedTxids);

      // Find which output handle covers this voutIdx
      let srcHandleId = `out-${voutIdx}`;
      for (const h of outputHandles) {
        if (h.voutIndices?.includes(voutIdx)) { srcHandleId = h.id; break; }
      }

      // Find which input handle covers this vinIdx
      let tgtHandleId = `in-${vinIdx}`;
      for (const h of inputHandles) {
        if (h.vinIndices?.includes(vinIdx)) { tgtHandleId = h.id; break; }
      }

      elkEdges.push({
        id: `${txid}-${voutIdx}-${spendingTxid}-${vinIdx}`,
        sources: [`${txid}::${srcHandleId}`],
        targets: [`${spendingTxid}::${tgtHandleId}`],
      });
    });
  }

  try {
    const graph = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        // INTERACTIVE uses node.x to assign layers, so ELK's layers match
        // our pre-computed X ordering instead of its own edge-based layers.
        'elk.layered.layering.strategy': 'INTERACTIVE',
        'elk.spacing.nodeNode': '200',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(NODE_GAP),
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      },
      children: elkNodes,
      edges: elkEdges,
    });

    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of (graph.children || [])) {
      if (node.id && node.y !== undefined) {
        positions[node.id] = {
          x: xPositions[node.id],
          y: node.y,
        };
      }
    }

    // Center Y around 0 and scale for more vertical spread
    const yValues = Object.values(positions).map(p => p.y);
    if (yValues.length > 0) {
      const centerY = (Math.min(...yValues) + Math.max(...yValues)) / 2;
      for (const id of Object.keys(positions)) {
        positions[id].y = (positions[id].y - centerY) * Y_SPREAD;
      }
    }

    return positions;
  } catch (e) {
    console.error('ELK layout failed, falling back to current positions', e);
    const positions: Record<string, { x: number; y: number }> = {};
    for (const txid of sorted) {
      positions[txid] = {
        x: xPositions[txid],
        y: transactions[txid].coordinates.y,
      };
    }
    return positions;
  }
}
