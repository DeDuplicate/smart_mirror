import { useEffect, useRef } from 'react';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';

const POLL_INTERVAL = 30_000; // 30 seconds

// ─── Derive connection state from health data ───────────────────────────────

function deriveStatus(integration) {
  // Not configured at all
  if (!integration.configured) {
    return 'not_configured';
  }

  // Google / Spotify: configured but no linked accounts
  if ('linkedAccounts' in integration && integration.linkedAccounts === 0) {
    return 'not_configured';
  }

  // Home Assistant: configured but not reachable
  if ('reachable' in integration && !integration.reachable) {
    return 'degraded';
  }

  // Has config + accounts/reachable => connected
  return 'connected';
}

// ─── useHealth Hook ─────────────────────────────────────────────────────────

export default function useHealth() {
  const setAllConnectionStatuses = useStore((s) => s.setAllConnectionStatuses);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const intervalRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    async function poll() {
      try {
        const health = await fetchApi('/api/system/health');

        if (!mounted) return;

        const statuses = {};

        if (health.integrations?.google) {
          statuses.google = deriveStatus(health.integrations.google);
        }

        if (health.integrations?.spotify) {
          statuses.spotify = deriveStatus(health.integrations.spotify);
        }

        if (health.integrations?.homeAssistant) {
          statuses.ha = deriveStatus(health.integrations.homeAssistant);
        }

        setAllConnectionStatuses(statuses);

        // WiFi is implicitly connected if health endpoint responds
        setConnectionStatus('wifi', 'connected');
      } catch {
        if (!mounted) return;
        // If health endpoint fails, mark wifi as degraded
        setConnectionStatus('wifi', 'degraded');
      }
    }

    // Initial poll
    poll();

    // Recurring poll
    intervalRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      mounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [setAllConnectionStatuses, setConnectionStatus]);
}
