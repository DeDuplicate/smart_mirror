import { useState, useEffect, useCallback, useRef } from 'react';
import useStore from '../store/index.js';

// ─── Display Schedule Hook ───────────────────────────────────────────────────
// Reads wake/sleep times from settings and determines if the display should
// be in sleep mode. Touch during sleep triggers temporary wake for 5 minutes.

const TEMP_WAKE_DURATION = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL = 60 * 1000; // check every minute

/**
 * Parse a time string "HH:MM" into { hours, minutes }.
 */
function parseTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return { hours, minutes };
}

/**
 * Convert hours and minutes to minutes since midnight.
 */
function toMinutes(hours, minutes) {
  return hours * 60 + minutes;
}

/**
 * Check if the current time is within the sleep window.
 * Sleep window is from sleepTime to wakeTime (may cross midnight).
 */
function isInSleepWindow(now, wakeStr, sleepStr) {
  const wake = parseTime(wakeStr);
  const sleep = parseTime(sleepStr);

  if (!wake || !sleep) return false;

  const currentMin = toMinutes(now.getHours(), now.getMinutes());
  const wakeMin = toMinutes(wake.hours, wake.minutes);
  const sleepMin = toMinutes(sleep.hours, sleep.minutes);

  if (sleepMin > wakeMin) {
    // Normal case: sleep 23:00, wake 06:00
    // Sleep window: 23:00 -> midnight -> 06:00
    return currentMin >= sleepMin || currentMin < wakeMin;
  } else {
    // Edge case: sleep 01:00, wake 06:00
    return currentMin >= sleepMin && currentMin < wakeMin;
  }
}

export default function useDisplaySchedule() {
  const displaySchedule = useStore((s) => s.settings.displaySchedule);
  const wakeTime = displaySchedule?.wake || '06:00';
  const sleepTime = displaySchedule?.sleep || '23:00';

  const [isSleeping, setIsSleeping] = useState(false);
  const tempWakeTimerRef = useRef(null);
  const tempWakeRef = useRef(false);

  // Check sleep state
  const checkSleep = useCallback(() => {
    if (tempWakeRef.current) return; // temporarily awake

    const now = new Date();
    const shouldSleep = isInSleepWindow(now, wakeTime, sleepTime);
    setIsSleeping(shouldSleep);
  }, [wakeTime, sleepTime]);

  // Temporarily wake the display for 5 minutes
  const wakeTemporarily = useCallback(() => {
    // Clear any existing temp wake timer
    if (tempWakeTimerRef.current) {
      clearTimeout(tempWakeTimerRef.current);
    }

    tempWakeRef.current = true;
    setIsSleeping(false);

    // Set timer to go back to sleep
    tempWakeTimerRef.current = setTimeout(() => {
      tempWakeRef.current = false;
      // Re-check if we should be sleeping
      const now = new Date();
      const shouldSleep = isInSleepWindow(now, wakeTime, sleepTime);
      setIsSleeping(shouldSleep);
    }, TEMP_WAKE_DURATION);
  }, [wakeTime, sleepTime]);

  useEffect(() => {
    // Initial check
    checkSleep();

    // Check every minute
    const interval = setInterval(checkSleep, CHECK_INTERVAL);

    return () => {
      clearInterval(interval);
      if (tempWakeTimerRef.current) {
        clearTimeout(tempWakeTimerRef.current);
      }
    };
  }, [checkSleep]);

  return { isSleeping, wakeTemporarily };
}
