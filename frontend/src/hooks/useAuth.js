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

// ─── Popup window helper ────────────────────────────────────────────────────
// OAuth consent pages (Google, Spotify) send X-Frame-Options / CSP headers
// that block them from ever loading inside an <iframe>. They must be opened
// as a real top-level popup window instead.

function openAuthPopup(url) {
  try {
    const width = 520;
    const height = 680;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
    const popup = window.open(
      url,
      'oauth-popup',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );
    // Kiosk / popup-blocker: window.open returns null, or the same window.
    if (!popup || popup === window) return null;
    return popup;
  } catch {
    return null;
  }
}

async function launchOAuth(url, popup) {
  if (popup && !popup.closed) {
    popup.location.replace(url);
    return popup;
  }
  // Fallback for kiosk Chromium (--kiosk blocks popups): same-window redirect.
  window.location.assign(url);
  return null;
}

// ─── useAuth Hook ───────────────────────────────────────────────────────────

export default function useAuth() {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [provider, setProvider] = useState(null);
  const [authUrl, setAuthUrl] = useState(null);
  const [error, setError] = useState(null);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const callbackRef = useRef(null);
  const popupRef = useRef(null);

  const closePopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
  }, []);

  // Listen for socket auth events
  useEffect(() => {
    const sock = getSocket();

    const handleGoogleLinked = (data) => {
      setConnectionStatus('google', 'connected');
      if (callbackRef.current) {
        callbackRef.current(data);
        callbackRef.current = null;
      }
      closePopup();
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
      closePopup();
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
  }, [setConnectionStatus, closePopup]);

  // Poll the popup window — if the person closes it manually before
  // completing the OAuth flow, reset our "authenticating" state so the
  // connect button doesn't spin forever.
  useEffect(() => {
    if (!authUrl) return undefined;

    const interval = setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        clearInterval(interval);
        popupRef.current = null;
        callbackRef.current = null;
        setIsAuthenticating(false);
        setProvider(null);
        setAuthUrl(null);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [authUrl]);

  // Start Google OAuth flow
  const startGoogleAuth = useCallback(async (onSuccess) => {
    // Open the popup SYNCHRONOUSLY on the click — after any await, browsers
    // treat window.open as a blocked popup and kiosk Chromium does nothing.
    const popup = openAuthPopup('about:blank');
    setError(null);
    setIsAuthenticating(true);
    setProvider('google');
    callbackRef.current = onSuccess || null;

    try {
      const data = await fetchApi('/api/auth/google/url');
      popupRef.current = await launchOAuth(data.url, popup);
      setAuthUrl(data.url);
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      setError(err.message || 'Failed to get Google auth URL');
      setIsAuthenticating(false);
      setProvider(null);
    }
  }, []);

  // Start Spotify OAuth flow
  const startSpotifyAuth = useCallback(async (onSuccess) => {
    const popup = openAuthPopup('about:blank');
    setError(null);
    setIsAuthenticating(true);
    setProvider('spotify');
    callbackRef.current = onSuccess || null;

    try {
      const data = await fetchApi('/api/auth/spotify/url');
      popupRef.current = await launchOAuth(data.url, popup);
      setAuthUrl(data.url);
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      setError(err.message || 'Failed to get Spotify auth URL');
      setIsAuthenticating(false);
      setProvider(null);
    }
  }, []);

  // Re-open the popup with a fresh auth URL (used after a timeout)
  const retryAuth = useCallback(async () => {
    if (!provider) return;
    const popup = openAuthPopup('about:blank');
    setError(null);

    try {
      const data = await fetchApi(`/api/auth/${provider}/url`);
      closePopup();
      popupRef.current = await launchOAuth(data.url, popup);
      setAuthUrl(data.url);
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      setError(err.message || 'Failed to restart auth flow');
    }
  }, [provider, closePopup]);

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
      await fetchApi('/api/auth/spotify', {
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
    closePopup();
    setIsAuthenticating(false);
    setProvider(null);
    setAuthUrl(null);
    callbackRef.current = null;
  }, [closePopup]);

  return {
    isAuthenticating,
    provider,
    authUrl,
    error,
    startGoogleAuth,
    startSpotifyAuth,
    retryAuth,
    getGoogleAccounts,
    removeGoogleAccount,
    removeSpotifyAccount,
    cancelAuth,
  };
}
