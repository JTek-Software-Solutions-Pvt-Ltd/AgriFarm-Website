/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import {
  AlertTriangle,
  Bot,
  CloudSun,
  MapPin,
  Sparkles,
  Sprout,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import type { RootState } from '../../../app/store';
import { useAppSelector } from '../../../app/store/hooks';
import { useTranslation } from '../../../shared/i18n';
import { WelcomeResponse } from '../../../shared/types';
import { selectIsAuthenticated } from '../../auth/store/authSlice';
import {
  fetchWelcomeApi,
  getLocalDateKey,
  getWelcomeSeenDate,
  markWelcomeSeenToday,
} from '../services/welcomeApi';

interface WelcomePopupModalProps {
  onOpenAiChat?: (sessionId?: string | null, welcomeMessage?: string | null) => void;
}

function selectAuthenticatedNumericUserId(state: RootState): number | null {
  if (!state.auth.isAuthenticated || !state.auth.user) return null;
  const raw = (state.auth.user.rawId || state.auth.user.id || '').replace(/^farmer-/, '').trim();
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLocationText(welcome: WelcomeResponse): string {
  const loc = welcome.farmer?.location;
  if (!loc) return '';
  const parts = [loc.village, loc.district, loc.state]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0 && item.toLowerCase() !== 'string');
  if (parts.length > 0) return parts.join(', ');
  if (typeof loc.label === 'string' && loc.label.trim() && loc.label.trim().toLowerCase() !== 'string') {
    return loc.label.trim();
  }
  return '';
}

function normalizeAlertLabel(alert: Record<string, unknown> | string): {
  title: string;
  severity: string;
  description: string;
} {
  if (typeof alert === 'string') {
    return { title: 'Weather Alert', severity: 'INFO', description: alert };
  }
  const title = String(alert.title || alert.type || alert.alert_type || 'Weather Alert').trim();
  const severity = String(alert.severity || alert.level || 'ALERT').trim().toUpperCase();
  const description = String(
    alert.description || alert.message || alert.farmer_action || ''
  ).trim();
  return { title, severity, description };
}

function extractWeatherSnapshotText(weather: Record<string, unknown> | null | undefined): string {
  if (!weather || typeof weather !== 'object') return '';
  const current =
    weather.current && typeof weather.current === 'object'
      ? (weather.current as Record<string, unknown>)
      : weather;
  const temp = current.temperature_c ?? current.temperature ?? weather.temperature_c;
  const humidity = current.humidity_percent ?? current.humidity ?? weather.humidity_percent;
  const summary =
    typeof weather.summary === 'string'
      ? weather.summary.trim()
      : typeof weather.condition === 'string'
        ? weather.condition.trim()
        : '';
  const segments: string[] = [];
  if (typeof temp === 'number' && Number.isFinite(temp)) {
    segments.push(`${Math.round(temp)}°C`);
  }
  if (typeof humidity === 'number' && Number.isFinite(humidity)) {
    segments.push(`${Math.round(humidity)}% RH`);
  }
  if (summary) {
    segments.push(summary);
  }
  return segments.join(' • ');
}

/**
 * Isolated controller + popup modal for the personalized Welcome API.
 * - Triggers immediately whenever a user logs in.
 * - When already logged in across sessions/days, triggers once per local calendar day.
 * - Subscribes only to auth state + numeric user ID so weather/tab updates never cause re-renders.
 */
export const WelcomePopupModal: React.FC<WelcomePopupModalProps> = memo(({ onOpenAiChat }) => {
  const store = useStore<RootState>();
  const { language } = useTranslation();

  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const numericUserId = useAppSelector(selectAuthenticatedNumericUserId);

  const [welcomeData, setWelcomeData] = useState<WelcomeResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [dayCheckTick, setDayCheckTick] = useState(0);

  const languageRef = useRef(language);
  languageRef.current = language;

  // True if session was already authenticated at initial mount; false -> true indicates fresh login.
  const wasAuthenticatedRef = useRef<boolean>(isAuthenticated);
  const loginNonceRef = useRef<number>(0);
  const inFlightKeyRef = useRef<string | null>(null);
  const completedKeyRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopVoiceAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsAudioPlaying(false);
  }, []);

  const handleClose = useCallback(() => {
    stopVoiceAudio();
    setIsOpen(false);
  }, [stopVoiceAudio]);

  // Listen for day rollover when returning to an already logged-in browser tab
  useEffect(() => {
    if (!isAuthenticated || numericUserId === null) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const todayKey = getLocalDateKey();
      if (getWelcomeSeenDate(numericUserId) !== todayKey) {
        setDayCheckTick((tick) => tick + 1);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isAuthenticated, numericUserId]);

  useEffect(() => {
    if (!isAuthenticated || numericUserId === null) {
      wasAuthenticatedRef.current = false;
      inFlightKeyRef.current = null;
      completedKeyRef.current = null;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      stopVoiceAudio();
      setIsOpen(false);
      setWelcomeData(null);
      return;
    }

    const todayKey = getLocalDateKey();
    const isFreshLogin = !wasAuthenticatedRef.current;

    if (isFreshLogin) {
      wasAuthenticatedRef.current = true;
      loginNonceRef.current += 1;
    }

    let triggerKey: string;
    if (isFreshLogin) {
      triggerKey = `login:${numericUserId}:${loginNonceRef.current}`;
    } else {
      if (getWelcomeSeenDate(numericUserId) === todayKey) {
        return;
      }
      triggerKey = `daily:${numericUserId}:${todayKey}`;
    }

    if (
      inFlightKeyRef.current === triggerKey ||
      completedKeyRef.current === triggerKey
    ) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    inFlightKeyRef.current = triggerKey;

    const stateSnapshot = store.getState();
    const weatherLoc = stateSnapshot.weather.location;
    const authUser = stateSnapshot.auth.user;

    const rawLocName =
      (weatherLoc?.label && weatherLoc.label.trim()) ||
      [authUser?.village, authUser?.district, authUser?.state].filter(Boolean).join(', ') ||
      null;
    const locationName = rawLocName ? rawLocName.slice(0, 200) : null;

    const latCandidate =
      typeof weatherLoc?.latitude === 'number' && Number.isFinite(weatherLoc.latitude)
        ? weatherLoc.latitude
        : typeof authUser?.latitude === 'number' && Number.isFinite(authUser.latitude)
          ? authUser.latitude
          : null;
    const lngCandidate =
      typeof weatherLoc?.longitude === 'number' && Number.isFinite(weatherLoc.longitude)
        ? weatherLoc.longitude
        : typeof authUser?.longitude === 'number' && Number.isFinite(authUser.longitude)
          ? authUser.longitude
          : null;

    const activeLang = (languageRef.current || 'en').trim().toLowerCase().slice(0, 12) || 'en';

    fetchWelcomeApi(
      {
        user_id: numericUserId,
        language: activeLang,
        location_name: locationName,
        latitude: latCandidate,
        longitude: lngCandidate,
      },
      controller.signal
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        inFlightKeyRef.current = null;
        completedKeyRef.current = triggerKey;
        markWelcomeSeenToday(numericUserId, getLocalDateKey());
        setWelcomeData(response);
        setIsOpen(true);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (inFlightKeyRef.current === triggerKey) {
            inFlightKeyRef.current = null;
          }
          return;
        }
        // Prevent retry loops within this mount/login event if upstream returns 502/error
        inFlightKeyRef.current = null;
        completedKeyRef.current = triggerKey;
        console.warn(
          '[WelcomeAPI]',
          err instanceof Error ? err.message : 'Unable to fetch welcome message.'
        );
      });

    return () => {
      if (abortControllerRef.current === controller) {
        controller.abort();
        abortControllerRef.current = null;
      }
      if (inFlightKeyRef.current === triggerKey) {
        inFlightKeyRef.current = null;
      }
    };
  }, [isAuthenticated, numericUserId, dayCheckTick, store, stopVoiceAudio]);

  // Close cleanly with Escape key while open
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  const handleToggleVoice = useCallback(() => {
    if (isAudioPlaying) {
      stopVoiceAudio();
      return;
    }
    const base64 = welcomeData?.voice?.audio_base64;
    if (!base64) return;
    const format = (welcomeData.voice?.format || 'wav').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'wav';
    const src = base64.startsWith('data:') ? base64 : `data:audio/${format};base64,${base64}`;
    try {
      const audio = new Audio(src);
      audioRef.current = audio;
      audio.onended = () => {
        audioRef.current = null;
        setIsAudioPlaying(false);
      };
      audio.onerror = () => {
        audioRef.current = null;
        setIsAudioPlaying(false);
      };
      setIsAudioPlaying(true);
      audio.play().catch(() => {
        audioRef.current = null;
        setIsAudioPlaying(false);
      });
    } catch {
      setIsAudioPlaying(false);
    }
  }, [isAudioPlaying, stopVoiceAudio, welcomeData]);

  if (!isOpen || !welcomeData) {
    return null;
  }

  const farmerName = welcomeData.farmer?.name?.trim() || 'Farmer';
  const cropName = welcomeData.farmer?.crop?.name?.trim() || '';
  const cropSeason = welcomeData.farmer?.crop?.season?.trim() || '';
  const locationText = normalizeLocationText(welcomeData);
  const weatherSnapshot = extractWeatherSnapshotText(welcomeData.weather);
  const alerts = Array.isArray(welcomeData.weather_alerts)
    ? welcomeData.weather_alerts.slice(0, 3).map(normalizeAlertLabel)
    : [];
  const hasVoiceAudio = Boolean(welcomeData.voice?.available && welcomeData.voice?.audio_base64);

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0d2219]/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kd-welcome-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white border border-[#d5e7db] shadow-2xl overflow-hidden text-[#1A2821]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Banner */}
        <div className="bg-gradient-to-r from-[#113E2E] via-[#17503c] to-[#1d634a] px-6 py-5 text-white relative">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-[#E5B54F]/20 border border-[#E5B54F]/50 flex items-center justify-center shrink-0 text-[#E5B54F]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-200/90">
                  Kisan Dost Daily Briefing
                </p>
                <h2
                  id="kd-welcome-title"
                  className="text-lg sm:text-xl font-serif font-bold tracking-tight truncate mt-0.5"
                >
                  <span>Welcome, </span>
                  <span className="notranslate" translate="no">
                    {farmerName}
                  </span>
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              aria-label="Close welcome popup"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 bg-[#F8FAF7]">
          {/* Personalized Greeting */}
          <div className="rounded-2xl bg-white border border-[#e0ede5] p-4 shadow-xs">
            <p className="text-sm sm:text-[15px] leading-relaxed text-[#1A2821] font-medium">
              <span className="notranslate" translate="no">
                {welcomeData.message}
              </span>
            </p>
            {hasVoiceAudio && (
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">Voice greeting available</span>
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#113E2E]/10 hover:bg-[#113E2E]/15 text-[#113E2E] text-xs font-semibold transition-colors cursor-pointer"
                >
                  {isAudioPlaying ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop Voice</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Play Greeting</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Crop, Location & Weather Snapshot */}
          {(cropName || locationText || weatherSnapshot) && (
            <div className="flex flex-wrap gap-2">
              {cropName && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold">
                  <Sprout className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span className="notranslate" translate="no">
                    {cropName}
                    {cropSeason ? ` (${cropSeason})` : ''}
                  </span>
                </div>
              )}

              {locationText && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-semibold">
                  <MapPin className="w-3.5 h-3.5 text-[#113E2E] shrink-0" />
                  <span className="notranslate" translate="no">
                    {locationText}
                  </span>
                </div>
              )}

              {weatherSnapshot && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs font-semibold">
                  <CloudSun className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span className="notranslate" translate="no">
                    {weatherSnapshot}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Weather Alerts if present */}
          {alerts.length > 0 && (
            <div className="space-y-2">
              {alerts.map((alert, idx) => (
                <div
                  key={`${alert.title}-${idx}`}
                  className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 flex items-start gap-2.5"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="min-w-0 text-xs">
                    <p className="font-bold text-amber-950">
                      <span>{alert.title}</span>
                      {alert.severity ? (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-amber-700">
                          • {alert.severity}
                        </span>
                      ) : null}
                    </p>
                    {alert.description ? (
                      <p className="text-amber-900 mt-0.5 leading-snug">{alert.description}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {onOpenAiChat && (
            <div className="flex items-center justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  const sid = welcomeData.session_id ?? null;
                  const msg = welcomeData.message ?? null;
                  handleClose();
                  onOpenAiChat(sid, msg);
                }}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#113E2E] hover:bg-[#0a291f] text-white text-sm font-semibold shadow-sm transition-colors cursor-pointer"
              >
                <Bot className="w-4 h-4 text-[#E5B54F]" />
                <span>Ask Dost AI</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
