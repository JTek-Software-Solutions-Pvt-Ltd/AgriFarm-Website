/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CHAT_API_PATH,
  DEFAULT_API_HEADERS,
  getAiApiBaseUrl,
} from '../../../shared/config/api';

export interface AiChatRequestPayload {
  user_id: number;
  message: string;
  language: string;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  session_id: string | null;
}

export interface AiChatResponsePayload {
  session_id: string;
  language: string;
  intent: 'weather' | 'crop' | 'market' | 'general' | string;
  response_text: string;
  weather?: Record<string, unknown> | null;
  model_used?: string;
  speech_ready?: boolean;
  speech_note?: string;
}

/**
 * Calls POST /ai/api/v1/chat on the AI backend while preserving session_id continuity.
 */
export async function sendAiChatMessageApi(
  payload: AiChatRequestPayload,
  signal?: AbortSignal
): Promise<AiChatResponsePayload> {
  const requestUrl = `${getAiApiBaseUrl()}${CHAT_API_PATH}`;

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
    throw new Error('Unable to reach the Dost AI Chat service.');
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json || typeof json.response_text !== 'string') {
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
      detailMsg || json?.message || `Chat service returned status ${res.status}.`
    );
  }

  return json as AiChatResponsePayload;
}
