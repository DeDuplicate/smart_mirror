import { useState, useCallback, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';

// ─── Socket singleton (reuse the same instance pattern from App) ────────────

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

// ─── useAuth Hook ───────────────────────────────────────────────────────────

export default function useAuth() {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [provider, setProvider] = useState(null);
  const [authUrl, setAuthUrl] = useState(null);
  const [error, setError] = useState(null);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const callbackRef = useRef(null);

  // Listen for socket auth events
  useEffect(() => {
    const sock = getSocket();

    const handleGoogleLinked = (data) => {
      setConnectionStatus('google', 'connected');
      if (callbackRef.current) {
        callbackRef.current(data);
        callbackRef.current = null;
      }
      setIsAuthenticating(false);
      setProvider(null);
      setAuthUrl(null);
    };

    const handleSpotifyLinked = (data) => {
      setConnectionStatus('spotify', 'connected');
      if (callbackRef.current) {
        callbackRef.current(data);
        callbackRef.current = null;
      }
      setIsAuthenticating(false);
      setProvider(null);
      setAuthUrl(null);
    };

    const handleGoogleUnlinked = () => {
      setConnectionStatus('google', 'not_configured');
    };

    sock.on('auth:google:linked', handleGoogleLinked);
    sock.on('auth:spotify:linked', handleSpotifyLinked);
    sock.on('auth:google:unlinked', handleGoogleUnlinked);

    return () => {
      sock.off('auth:google:linked', handleGoogleLinked);
      sock.off('auth:spotify:linked', handleSpotifyLinked);
      sock.off('auth:google:unlinked', handleGoogleUnlinked);
    };
  }, [setConnectionStatus]);

  // Start Google OAuth flow
  const startGoogleAuth = useCallback(async (onSuccess) => {
    setError(null);
    setIsAuthenticating(true);
    setProvider('google');
    callbackRef.current = onSuccess || null;

    try {
      const data = await fetchApi('/api/auth/google/url');
      setAuthUrl(data.url);
    } catch (err) {
      setError(err.message || 'Failed to get Google auth URL');
      setIsAuthenticating(false);
      setProvider(null);
    }
  }, []);

  // Start Spotify OAuth flow
  const startSpotifyAuth = useCallback(async (onSuccess) => {
    setError(null);
    setIsAuthenticating(true);
    setProvider('spotify');
    callbackRef.current = onSuccess || null;

    try {
      const data = await fetchApi('/api/auth/spotify/url');
      setAuthUrl(data.url);
    } catch (err) {
      setError(err.message || 'Failed to get Spotify auth URL');
      setIsAuthenticating(false);
      setProvider(null);
    }
  }, []);

  // Get linked Google accounts
  const getGoogleAccounts = useCallback(async () => {
    try {
      const data = await fetchApi('/api/auth/google/accounts');
      return data.accounts || [];
    } catch {
      return [];
    }
  }, []);

  // Remove a Google account by email
  const removeGoogleAccount = useCallback(
    async (email) => {
      try {
        await fetchApi(`/api/auth/google/${encodeURIComponent(email)}`, {
          method: 'DELETE',
        });
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  // Remove Spotify account
  const removeSpotifyAccount = useCallback(async () => {
    try {
      await fetchApi('/api/auth/spotify/disconnect', {
        method: 'DELETE',
      });
      setConnectionStatus('spotify', 'not_configured');
      return true;
    } catch {
      return false;
    }
  }, [setConnectionStatus]);

  // Close the overlay / cancel auth
  const cancelAuth = useCallback(() => {
    setIsAuthenticating(false);
    setProvider(null);
    setAuthUrl(null);
    callbackRef.current = null;
  }, []);

  return {
    isAuthenticating,
    provider,
    authUrl,
    error,
    startGoogleAuth,
    startSpotifyAuth,
    getGoogleAccounts,
    removeGoogleAccount,
    removeSpotifyAccount,
    cancelAuth,
  };
}
