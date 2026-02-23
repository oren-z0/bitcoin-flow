import { useEffect, useRef } from 'react';
import { useGlobalState } from './useGlobalState';

export function useMempoolWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      try {
        const ws = new WebSocket('wss://mempool.space/api/v1/ws');
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ action: 'want', data: ['blocks'] }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.block) {
              onNewBlock();
            }
          } catch (e) {
            // Ignore parse errors
          }
        };

        ws.onerror = () => {
          ws.close();
        };

        ws.onclose = () => {
          if (mounted) {
            // Reconnect after 30 seconds
            reconnectTimeoutRef.current = setTimeout(connect, 30000);
          }
        };
      } catch (e) {
        if (mounted) {
          reconnectTimeoutRef.current = setTimeout(connect, 30000);
        }
      }
    };

    connect();

    return () => {
      mounted = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);
}

function onNewBlock() {
  const { transactions, refreshTransaction } = useGlobalState.getState();

  for (const [txid, stored] of Object.entries(transactions)) {
    const needsRefresh =
      !stored.data.status.confirmed ||
      stored.outspends.some(o => !o.spent);

    if (needsRefresh) {
      refreshTransaction(txid);
    }
  }
}
