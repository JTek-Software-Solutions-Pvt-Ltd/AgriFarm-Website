/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_API_HEADERS,
  WELCOME_API_PATH,
  getAiApiBaseUrl,
} from '../../../shared/config/api';
import { WelcomeRequest, WelcomeResponse } from '../../../shared/types';

const WELCOME_SEEN_STORAGE_PREFIX = 'kd_welcome_seen_';

/**
 * Returns local calendar date in YYYY-MM-DD format so daily display checks
 * match the farmer's local day without UTC midnight drift.
 */
export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getWelcomeSeenDate(userId: number): string | null {
  try {
    return localStorage.getItem(`${WELCOME_SEEN_STORAGE_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

export function markWelcomeSeenToday(userId: number, dateKey: string = getLocalDateKey()): void {
  try {
    localStorage.setItem(`${WELCOME_SEEN_STORAGE_PREFIX}${userId}`, dateKey);
  } catch {
    // Ignore private-mode / quota storage failures cleanly
  }
}

/**
 * Calls POST /ai/api/v1/welcome directly against the AI backend server.
 */
export async function fetchWelcomeApi(
  payload: WelcomeRequest,
  signal?: AbortSignal
): Promise<WelcomeResponse> {
  const requestUrl = `${getAiApiBaseUrl()}${WELCOME_API_PATH}`;

  let res: Response;
  try {
    res = await fetch(requestUrl, {
      method: 'POST',
      headers: DEFAULT_API_HEADERS,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new Error('Unable to reach the Welcome AI service.');
  }

  const json = await res.json().catch(() => null);
  if (
    !res.ok ||
    !json ||
    json.success !== true ||
    typeof json.message !== 'string' ||
    !json.message.trim()
  ) {
    const detailMsg = Array.isArray(json?.detail)
      ? json.detail
          .map((item: { msg?: string; loc?: Array<string | number> }) =>
            item?.msg ? `${item.loc?.slice(-1)[0] ?? 'field'}: ${item.msg}` : ''
          )
          .filter(Boolean)
          .join('; ')
      : typeof json?.detail === 'string'
        ? json.detail
        : '';
    throw new Error(
      detailMsg || json?.message || `Welcome service returned status ${res.status}.`
    );
  }

  return json as WelcomeResponse;
}
