/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Uses VITE_API_BASE_URL from .env when set, otherwise defaults to the backend API.
 */
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://20.12.240.74:7000'
).replace(/\/$/, '');

export const AI_BACKEND_BASE_URL = 'http://20.12.240.74';

/**
 * Uses VITE_AI_API_BASE_URL when configured.
 * On HTTP origins (e.g. localhost:3000), calls the backend server directly
 * (http://20.12.240.74/ai/...) so requests never hit localhost:3000.
 * On HTTPS origins (e.g. cloud previews), uses same-origin /ai proxy to avoid mixed-content blocking.
 */
export function getAiApiBaseUrl(): string {
  const explicit = (import.meta.env.VITE_AI_API_BASE_URL || '').replace(/\/$/, '');
  if (explicit) return explicit;

  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return '';
  }

  return AI_BACKEND_BASE_URL;
}

export const AI_API_BASE_URL = getAiApiBaseUrl();

/**
 * Resolves base URL for IMD weather endpoints (/api/weather/imd/*).
 * Uses VITE_API_BASE_URL if set; on HTTP origins calls http://20.12.240.74 directly,
 * and on HTTPS origins uses same-origin proxy to avoid mixed-content errors.
 */
export function getImdApiBaseUrl(): string {
  const explicit = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (explicit) return explicit;

  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return '';
  }

  return AI_BACKEND_BASE_URL;
}

export const DEFAULT_API_HEADERS: HeadersInit = {
  accept: '*/*',
  'Content-Type': 'application/json',
};

export const WELCOME_API_PATH = '/ai/api/v1/welcome';
export const CHAT_API_PATH = '/ai/api/v1/chat';
export const VOICE_WS_PATH = '/ai/api/v1/voice/ws';
export const VOICE_WS_BACKEND_URL = `ws://20.12.240.74${VOICE_WS_PATH}`;

/**
 * Resolves the WebSocket URL for the Voice-to-Voice assistant.
 * Uses VITE_VOICE_WS_URL when explicitly set.
 * On HTTP origins (e.g. localhost:3000), connects directly to the backend server
 * (ws://20.12.240.74/ai/api/v1/voice/ws).
 * On HTTPS origins (e.g. cloud previews), browsers block ws:// mixed content,
 * so it connects over wss:// via the same-origin /ai WebSocket proxy to 20.12.240.74.
 */
export function getVoiceWebSocketUrl(): string {
  const explicitWs = (import.meta.env.VITE_VOICE_WS_URL || '').trim();
  if (explicitWs) return explicitWs;

  if (AI_API_BASE_URL) {
    const wsBase = AI_API_BASE_URL.replace(/^http/i, 'ws');
    return `${wsBase}${VOICE_WS_PATH}`;
  }

  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return `wss://${window.location.host}${VOICE_WS_PATH}`;
  }

  return VOICE_WS_BACKEND_URL;
}
