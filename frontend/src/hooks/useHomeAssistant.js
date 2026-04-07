import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';

// ─── Socket.io singleton ────────────────────────────────────────────────────

let socket = null;

function getSocket() {
  if (!socket) {
    socket = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });
  }
  return socket;
}

// ─── Mock Data (dev fallback) ───────────────────────────────────────────────

const MOCK_ENTITIES = [
  {
    entity_id: 'light.living_room',
    state: 'on',
    attributes: {
      friendly_name: 'תאורת סלון',
      brightness: 204,
      color_temp: 370,
      min_mireds: 153,
      max_mireds: 500,
      supported_features: 44,
    },
  },
  {
    entity_id: 'light.bedroom',
    state: 'off',
    attributes: {
      friendly_name: 'תאורת חדר שינה',
      brightness: 0,
      supported_features: 40,
    },
  },
  {
    entity_id: 'light.kitchen',
    state: 'on',
    attributes: {
      friendly_name: 'תאורת מטבח',
      brightness: 127,
      supported_features: 40,
    },
  },
  {
    entity_id: 'climate.ac_living_room',
    state: 'cool',
    attributes: {
      friendly_name: 'מזגן סלון',
      temperature: 24,
      current_temperature: 26.5,
      hvac_modes: ['off', 'cool', 'heat', 'auto', 'fan_only'],
      min_temp: 16,
      max_temp: 30,
      hvac_action: 'cooling',
    },
  },
  {
    entity_id: 'media_player.living_room_tv',
    state: 'on',
    attributes: {
      friendly_name: 'טלוויזיה',
      volume_level: 0.35,
      is_volume_muted: false,
      media_content_type: 'tvshow',
      supported_features: 152461,
    },
  },
  {
    entity_id: 'media_player.speaker',
    state: 'idle',
    attributes: {
      friendly_name: 'רמקול',
      volume_level: 0.5,
      is_volume_muted: false,
      supported_features: 152461,
    },
  },
  {
    entity_id: 'cover.main_gate',
    state: 'closed',
    attributes: {
      friendly_name: 'שער כניסה',
      current_position: 0,
      supported_features: 15,
    },
  },
  {
    entity_id: 'lock.front_door',
    state: 'locked',
    attributes: {
      friendly_name: 'מנעול דלת',
      supported_features: 0,
    },
  },
  {
    entity_id: 'switch.boiler',
    state: 'off',
    attributes: {
      friendly_name: 'דוד שמש',
      supported_features: 0,
    },
  },
  {
    entity_id: 'fan.bedroom',
    state: 'off',
    attributes: {
      friendly_name: 'מאוורר חדר שינה',
      percentage: 0,
      supported_features: 1,
    },
  },
];

// ─── Scene Mock Data ────────────────────────────────────────────────────────

export const MOCK_SCENES = [
  { entity_id: 'scene.good_morning', name: 'בוקר טוב' },
  { entity_id: 'scene.movie_mode', name: 'מצב סרט' },
  { entity_id: 'scene.good_night', name: 'לילה טוב' },
  { entity_id: 'scene.leaving_home', name: 'יציאה מהבית' },
];

// ─── Hook ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 60_000; // 1 minute

export default function useHomeAssistant() {
  const haStatus = useStore((s) => s.connections.ha);
  const isConfigured = haStatus === 'connected' || haStatus === 'degraded';

  const [entities, setEntities] = useState([]);
  const [allStates, setAllStates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lastKnownStates, setLastKnownStates] = useState(null);

  const mountedRef = useRef(true);
  const pollRef = useRef(null);

  // ── Fetch all states ──────────────────────────────────────────────────────

  const fetchStates = useCallback(async () => {
    try {
      const res = await fetchApi('/api/ha/states');
      if (!mountedRef.current) return;

      const states = res?.states || [];
      // Store all states for person/script/todo lookups
      setAllStates(states);
      // Filter to relevant domains for device tiles
      const relevant = states.filter((e) => {
        const domain = e.entity_id.split('.')[0];
        return ['light', 'climate', 'switch', 'input_boolean', 'media_player',
                'cover', 'lock', 'fan'].includes(domain);
      });

      setEntities(relevant);
      setLastKnownStates(relevant);
      setConnected(true);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      // Use mock data in dev when API is unavailable
      if (entities.length === 0 && !lastKnownStates) {
        setEntities(MOCK_ENTITIES);
      } else if (lastKnownStates) {
        setEntities(lastKnownStates);
      }
      setConnected(false);
      setError(err.message);
      setLoading(false);
    }
  }, [entities.length, lastKnownStates]);

  // ── Initial fetch + polling ───────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    if (!isConfigured) {
      // Not configured: use mock data
      setEntities(MOCK_ENTITIES);
      setLoading(false);
      setConnected(false);
      return;
    }

    setLoading(true);
    fetchStates();

    pollRef.current = setInterval(fetchStates, POLL_INTERVAL);

    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isConfigured]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket.io real-time updates ───────────────────────────────────────────

  useEffect(() => {
    if (!isConfigured) return;

    const sock = getSocket();

    function handleStateChanged(data) {
      if (!data?.entity_id) return;

      setEntities((prev) =>
        prev.map((e) =>
          e.entity_id === data.entity_id
            ? {
                ...e,
                state: data.new_state?.state ?? e.state,
                attributes: {
                  ...e.attributes,
                  ...(data.new_state?.attributes || {}),
                },
              }
            : e
        )
      );
    }

    sock.on('ha:state_changed', handleStateChanged);

    return () => {
      sock.off('ha:state_changed', handleStateChanged);
    };
  }, [isConfigured]);

  // ── Service call helpers ──────────────────────────────────────────────────

  const callService = useCallback(
    async (domain, service, data = {}) => {
      try {
        await fetchApi(`/api/ha/services/${domain}/${service}`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
        // Optimistic update: refetch after a short delay
        setTimeout(fetchStates, 500);
      } catch (err) {
        console.error('HA service call failed:', err);
        throw err;
      }
    },
    [fetchStates]
  );

  const toggleEntity = useCallback(
    async (entityId) => {
      const domain = entityId.split('.')[0];

      // Optimistic UI update
      setEntities((prev) =>
        prev.map((e) => {
          if (e.entity_id !== entityId) return e;
          const isOn = e.state === 'on' || e.state === 'unlocked' || e.state === 'open';
          let newState;
          if (domain === 'lock') {
            newState = isOn ? 'locked' : 'unlocked';
          } else if (domain === 'cover') {
            newState = isOn ? 'closed' : 'open';
          } else {
            newState = isOn ? 'off' : 'on';
          }
          return { ...e, state: newState };
        })
      );

      try {
        if (domain === 'lock') {
          const entity = entities.find((e) => e.entity_id === entityId);
          const isLocked = entity?.state === 'locked';
          await callService('lock', isLocked ? 'unlock' : 'lock', { entity_id: entityId });
        } else if (domain === 'cover') {
          const entity = entities.find((e) => e.entity_id === entityId);
          const isClosed = entity?.state === 'closed';
          await callService('cover', isClosed ? 'open_cover' : 'close_cover', { entity_id: entityId });
        } else {
          await callService('homeassistant', 'toggle', { entity_id: entityId });
        }
      } catch {
        // Revert on failure
        fetchStates();
      }
    },
    [entities, callService, fetchStates]
  );

  const setBrightness = useCallback(
    async (entityId, value) => {
      // Optimistic update
      setEntities((prev) =>
        prev.map((e) =>
          e.entity_id === entityId
            ? {
                ...e,
                state: value > 0 ? 'on' : 'off',
                attributes: { ...e.attributes, brightness: Math.round((value / 100) * 255) },
              }
            : e
        )
      );
      await callService('light', 'turn_on', {
        entity_id: entityId,
        brightness_pct: value,
      });
    },
    [callService]
  );

  const setColorTemp = useCallback(
    async (entityId, mireds) => {
      setEntities((prev) =>
        prev.map((e) =>
          e.entity_id === entityId
            ? { ...e, attributes: { ...e.attributes, color_temp: mireds } }
            : e
        )
      );
      await callService('light', 'turn_on', {
        entity_id: entityId,
        color_temp: mireds,
      });
    },
    [callService]
  );

  const setTemperature = useCallback(
    async (entityId, temp) => {
      setEntities((prev) =>
        prev.map((e) =>
          e.entity_id === entityId
            ? { ...e, attributes: { ...e.attributes, temperature: temp } }
            : e
        )
      );
      await callService('climate', 'set_temperature', {
        entity_id: entityId,
        temperature: temp,
      });
    },
    [callService]
  );

  const setHvacMode = useCallback(
    async (entityId, mode) => {
      setEntities((prev) =>
        prev.map((e) =>
          e.entity_id === entityId ? { ...e, state: mode } : e
        )
      );
      await callService('climate', 'set_hvac_mode', {
        entity_id: entityId,
        hvac_mode: mode,
      });
    },
    [callService]
  );

  const setVolume = useCallback(
    async (entityId, volume) => {
      setEntities((prev) =>
        prev.map((e) =>
          e.entity_id === entityId
            ? { ...e, attributes: { ...e.attributes, volume_level: volume / 100 } }
            : e
        )
      );
      await callService('media_player', 'volume_set', {
        entity_id: entityId,
        volume_level: volume / 100,
      });
    },
    [callService]
  );

  const setCoverPosition = useCallback(
    async (entityId, position) => {
      setEntities((prev) =>
        prev.map((e) =>
          e.entity_id === entityId
            ? {
                ...e,
                state: position > 0 ? 'open' : 'closed',
                attributes: { ...e.attributes, current_position: position },
              }
            : e
        )
      );
      await callService('cover', 'set_cover_position', {
        entity_id: entityId,
        position,
      });
    },
    [callService]
  );

  const activateScene = useCallback(
    async (sceneEntityId) => {
      await callService('scene', 'turn_on', { entity_id: sceneEntityId });
    },
    [callService]
  );

  return {
    entities,
    allStates,
    loading,
    error,
    connected,
    toggleEntity,
    callService,
    setBrightness,
    setColorTemp,
    setTemperature,
    setHvacMode,
    setVolume,
    setCoverPosition,
    activateScene,
    refresh: fetchStates,
  };
}
