/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceWebSocketUrl } from '../../../shared/config/api';
import {
  computeRms,
  encodeFloat32PcmLittleEndian,
  isWavBuffer,
  resampleTo16kFloat32,
  TARGET_VOICE_SAMPLE_RATE,
  WavAudioPlayer,
} from '../services/voiceAudio';

export type VoiceSessionStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking_user'
  | 'processing'
  | 'playing_ai'
  | 'reconnecting'
  | 'error';

export interface VoiceAgentEvent {
  text: string;
  intent?: string;
  sessionId?: string;
  audioAvailable: boolean;
  audioFormat?: string;
  raw: Record<string, unknown>;
}

export interface UseVoiceToVoiceOptions {
  language: string;
  userId?: number;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  initialSessionId?: string | null;
  onSessionIdChange?: (sessionId: string | null) => void;
  onFinalTranscript: (transcript: string, sessionId?: string) => void;
  onAgentResponse: (event: VoiceAgentEvent) => void;
}

const PRE_ROLL_MAX_SAMPLES = Math.round(TARGET_VOICE_SAMPLE_RATE * 0.35); // 350ms
const STREAM_CHUNK_SAMPLES = 1600; // 100ms @ 16kHz (6,400 bytes Float32 LE)
const SPEECH_ONSET_FRAMES = 2;
const TRAILING_SILENCE_MS = 1100;
const MIN_TURN_AUDIO_MS = 350;
const MAX_TURN_AUDIO_MS = 25000;
const AUDIO_RESPONSE_TIMEOUT_MS = 14000;
const MAX_RECONNECT_ATTEMPTS = 3;

function mergeFloat32Chunks(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function useVoiceToVoice({
  language,
  userId,
  locationName,
  latitude,
  longitude,
  initialSessionId,
  onSessionIdChange,
  onFinalTranscript,
  onAgentResponse,
}: UseVoiceToVoiceOptions) {
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [partialTranscript, setPartialTranscript] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // Refs synced with latest props/callbacks so WebSocket & audio handlers always see current values
  const languageRef = useRef(language);
  const userIdRef = useRef(userId);
  const locationRef = useRef({ locationName, latitude, longitude });
  const onSessionIdChangeRef = useRef(onSessionIdChange);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const onAgentResponseRef = useRef(onAgentResponse);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    locationRef.current = { locationName, latitude, longitude };
  }, [locationName, latitude, longitude]);

  useEffect(() => {
    onSessionIdChangeRef.current = onSessionIdChange;
  }, [onSessionIdChange]);

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    onAgentResponseRef.current = onAgentResponse;
  }, [onAgentResponse]);

  // Session & WebSocket state
  const activeRef = useRef(false);
  const statusRef = useRef<VoiceSessionStatus>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(initialSessionId ?? null);

  useEffect(() => {
    const normalized = initialSessionId ?? null;
    if (sessionIdRef.current !== normalized) {
      sessionIdRef.current = normalized;
      setSessionId(normalized);
    }
  }, [initialSessionId]);
  const ttsReadyRef = useRef<boolean>(true);
  const manualCloseRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const audioWaitTimerRef = useRef<number | null>(null);
  const echoGuardUntilRef = useRef<number>(0);

  // Audio capture & playback refs
  const streamRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const playerRef = useRef<WavAudioPlayer | null>(null);

  // Turn recording & VAD state
  // 'idle' = listening for speech onset; 'recording' = buffering user speech locally;
  // 'analyzing' = speech stopped, recording sent to backend, mic listening paused until answer finishes
  const vadPhaseRef = useRef<'idle' | 'recording' | 'analyzing'>('idle');
  const preRollRef = useRef<Float32Array[]>([]);
  const preRollSamplesCountRef = useRef(0);
  const recordedChunksRef = useRef<Float32Array[]>([]);
  const pendingUtteranceSamplesRef = useRef<Float32Array | null>(null);
  const noiseFloorRef = useRef(0.008);
  const speechOnsetCountRef = useRef(0);
  const turnStartTimeRef = useRef(0);
  const lastVoiceTimeRef = useRef(0);
  const turnUserCommittedRef = useRef(false);
  const awaitingAudioRef = useRef(false);
  const agentTextReceivedRef = useRef(false);
  const partialBufferRef = useRef('');

  const setSyncedStatus = useCallback((next: VoiceSessionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (audioWaitTimerRef.current !== null) {
      window.clearTimeout(audioWaitTimerRef.current);
      audioWaitTimerRef.current = null;
    }
  }, []);

  const resetTurnState = useCallback(() => {
    vadPhaseRef.current = 'idle';
    preRollRef.current = [];
    preRollSamplesCountRef.current = 0;
    recordedChunksRef.current = [];
    pendingUtteranceSamplesRef.current = null;
    speechOnsetCountRef.current = 0;
    turnStartTimeRef.current = 0;
    lastVoiceTimeRef.current = 0;
    turnUserCommittedRef.current = false;
    awaitingAudioRef.current = false;
    agentTextReceivedRef.current = false;
    partialBufferRef.current = '';
    setPartialTranscript('');
    if (audioWaitTimerRef.current !== null) {
      window.clearTimeout(audioWaitTimerRef.current);
      audioWaitTimerRef.current = null;
    }
  }, []);

  const returnToListening = useCallback(() => {
    if (!activeRef.current) return;
    resetTurnState();
    echoGuardUntilRef.current = performance.now() + 300;
    setSyncedStatus('listening');
  }, [resetTurnState, setSyncedStatus]);

  /**
   * Sends the complete recorded voice utterance to the backend once the user stops speaking:
   * 1. Transitions to 'analyzing' / 'processing' so mic listening stops immediately.
   * 2. Sends JSON { type: 'start', ... } preserving session_id.
   * 3. On 'started', streams the recorded 16kHz Mono Float32 LE PCM chunks followed by { type: 'end' }.
   */
  const finalizeAndSendRecording = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (vadPhaseRef.current !== 'recording') return;

    const mergedSamples = mergeFloat32Chunks(recordedChunksRef.current);
    recordedChunksRef.current = [];
    preRollRef.current = [];
    preRollSamplesCountRef.current = 0;

    if (mergedSamples.length < Math.round(TARGET_VOICE_SAMPLE_RATE * 0.2)) {
      resetTurnState();
      setSyncedStatus('listening');
      return;
    }

    // Pause listening immediately while analyzing & waiting for answer
    vadPhaseRef.current = 'analyzing';
    pendingUtteranceSamplesRef.current = mergedSamples;
    turnUserCommittedRef.current = false;
    awaitingAudioRef.current = false;
    agentTextReceivedRef.current = false;
    setSyncedStatus('processing');

    const startPayload: Record<string, unknown> = {
      type: 'start',
      language: (languageRef.current || 'te').toLowerCase(),
      user_id: userIdRef.current && userIdRef.current > 0 ? userIdRef.current : 1,
    };
    if (sessionIdRef.current) {
      startPayload.session_id = sessionIdRef.current;
    }
    if (locationRef.current.locationName) {
      startPayload.location_name = locationRef.current.locationName;
    }
    if (typeof locationRef.current.latitude === 'number') {
      startPayload.latitude = locationRef.current.latitude;
    }
    if (typeof locationRef.current.longitude === 'number') {
      startPayload.longitude = locationRef.current.longitude;
    }

    console.info(
      `[VoiceWS] User stopped speaking (${(mergedSamples.length / TARGET_VOICE_SAMPLE_RATE).toFixed(
        2
      )}s recorded). Pausing mic & sending start:`,
      startPayload
    );
    ws.send(JSON.stringify(startPayload));
  }, [resetTurnState, setSyncedStatus]);

  const cleanupMedia = useCallback(() => {
    if (processorRef.current) {
      try {
        processorRef.current.onaudioprocess = null;
        processorRef.current.disconnect();
      } catch {
        // Ignore cleanup error
      }
      processorRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore cleanup error
      }
      sourceNodeRef.current = null;
    }
    if (silentGainRef.current) {
      try {
        silentGainRef.current.disconnect();
      } catch {
        // Ignore cleanup error
      }
      silentGainRef.current = null;
    }
    if (captureCtxRef.current && captureCtxRef.current.state !== 'closed') {
      captureCtxRef.current.close().catch(() => undefined);
      captureCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const stopVoice = useCallback(() => {
    if (!activeRef.current && statusRef.current === 'idle' && !wsRef.current) {
      return;
    }
    console.info('[VoiceWS] Stopping voice-to-voice connection (user clicked X / closed).');
    activeRef.current = false;
    manualCloseRef.current = true;
    clearTimers();
    resetTurnState();

    if (playerRef.current) {
      playerRef.current.stop();
    }

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close(1000, 'User stopped voice session');
        } else if (wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
      } catch {
        // Ignore close errors
      }
      wsRef.current = null;
    }

    cleanupMedia();
    setNoticeMessage(null);
    setSyncedStatus('idle');
  }, [cleanupMedia, clearTimers, resetTurnState, setSyncedStatus]);

  const handleBinaryAudioMessage = useCallback(
    async (arrayBuffer: ArrayBuffer) => {
      if (!activeRef.current) return;

      console.info(
        `[VoiceWS] <- Binary audio message received: ${arrayBuffer.byteLength} bytes, isWav=${isWavBuffer(
          arrayBuffer
        )}`
      );

      if (audioWaitTimerRef.current !== null) {
        window.clearTimeout(audioWaitTimerRef.current);
        audioWaitTimerRef.current = null;
      }
      awaitingAudioRef.current = false;

      if (!playerRef.current) {
        playerRef.current = new WavAudioPlayer();
      }

      // Stay non-listening while playing AI answer audio
      vadPhaseRef.current = 'analyzing';
      setSyncedStatus('playing_ai');
      try {
        await playerRef.current.playWav(arrayBuffer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to play AI audio response.';
        console.error('[VoiceAudio] WAV playback failed:', err);
        setErrorMessage(msg);
      }

      if (!activeRef.current) return;
      if (agentTextReceivedRef.current) {
        returnToListening();
      } else {
        setSyncedStatus('processing');
      }
    },
    [returnToListening, setSyncedStatus]
  );

  const handleJsonEvent = useCallback(
    (rawData: string) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(rawData) as Record<string, unknown>;
      } catch (parseErr) {
        console.error('[VoiceWS] Non-JSON text frame received:', rawData, parseErr);
        return;
      }

      const eventType = String(data.type || '').toLowerCase();
      console.info(`[VoiceWS] <- Event "${eventType}":`, data);

      switch (eventType) {
        case 'ready': {
          if (typeof data.tts_ready === 'boolean') {
            ttsReadyRef.current = data.tts_ready;
          }
          reconnectAttemptsRef.current = 0;
          setErrorMessage(null);
          if (activeRef.current && vadPhaseRef.current === 'idle') {
            setSyncedStatus('listening');
          }
          break;
        }

        case 'started': {
          const sid = typeof data.session_id === 'string' ? data.session_id : null;
          if (sid) {
            sessionIdRef.current = sid;
            setSessionId(sid);
            onSessionIdChangeRef.current?.(sid);
          }

          const ws = wsRef.current;
          const samples = pendingUtteranceSamplesRef.current;
          pendingUtteranceSamplesRef.current = null;

          if (ws && ws.readyState === WebSocket.OPEN && samples && samples.length > 0) {
            for (let offset = 0; offset < samples.length; offset += STREAM_CHUNK_SAMPLES) {
              const slice = samples.subarray(
                offset,
                Math.min(samples.length, offset + STREAM_CHUNK_SAMPLES)
              );
              ws.send(encodeFloat32PcmLittleEndian(slice));
            }
            console.info(
              `[VoiceWS] -> Sent ${samples.length} Float32 LE PCM samples & JSON end for session:`,
              sid
            );
            ws.send(JSON.stringify({ type: 'end' }));
          }
          break;
        }

        case 'partial_transcript': {
          const partialText = String(
            data.text ?? data.transcript ?? data.partial_text ?? data.content ?? ''
          ).trim();
          if (partialText) {
            partialBufferRef.current = partialText;
            setPartialTranscript(partialText);
          }
          break;
        }

        case 'final_transcript': {
          const finalText = String(
            data.text ?? data.transcript ?? data.final_text ?? data.content ?? partialBufferRef.current
          ).trim();
          const sid =
            typeof data.session_id === 'string'
              ? data.session_id
              : sessionIdRef.current || undefined;
          if (sid) {
            sessionIdRef.current = sid;
            setSessionId(sid);
            onSessionIdChangeRef.current?.(sid);
          }
          setPartialTranscript('');
          partialBufferRef.current = '';
          if (finalText && !turnUserCommittedRef.current) {
            turnUserCommittedRef.current = true;
            onFinalTranscriptRef.current(finalText, sid);
          }
          break;
        }

        case 'agent_response': {
          const responseText = String(
            data.text ?? data.response_text ?? data.response ?? data.message ?? ''
          ).trim();
          const intent = typeof data.intent === 'string' ? data.intent : undefined;
          const sid =
            typeof data.session_id === 'string'
              ? data.session_id
              : sessionIdRef.current || undefined;
          if (sid) {
            sessionIdRef.current = sid;
            setSessionId(sid);
            onSessionIdChangeRef.current?.(sid);
          }

          if (!turnUserCommittedRef.current && partialBufferRef.current.trim()) {
            turnUserCommittedRef.current = true;
            onFinalTranscriptRef.current(partialBufferRef.current.trim(), sid);
            partialBufferRef.current = '';
            setPartialTranscript('');
          }

          const explicitAudioFlag =
            typeof data.audio_available === 'boolean'
              ? data.audio_available
              : typeof data.has_audio === 'boolean'
                ? data.has_audio
                : typeof data.tts_ready === 'boolean'
                  ? data.tts_ready
                  : typeof data.speech_ready === 'boolean'
                    ? data.speech_ready
                    : typeof data.audio === 'boolean'
                      ? data.audio
                      : undefined;

          const audioFormat =
            typeof data.audio_format === 'string'
              ? data.audio_format
              : typeof data.format === 'string'
                ? data.format
                : undefined;

          const expectsAudio =
            explicitAudioFlag !== undefined
              ? explicitAudioFlag
              : Boolean(audioFormat) || ttsReadyRef.current;

          agentTextReceivedRef.current = true;

          onAgentResponseRef.current({
            text: responseText,
            intent,
            sessionId: sid,
            audioAvailable: expectsAudio,
            audioFormat,
            raw: data,
          });

          if (!expectsAudio) {
            if (statusRef.current !== 'playing_ai') {
              returnToListening();
            }
          } else if (statusRef.current !== 'playing_ai') {
            awaitingAudioRef.current = true;
            if (audioWaitTimerRef.current !== null) {
              window.clearTimeout(audioWaitTimerRef.current);
            }
            audioWaitTimerRef.current = window.setTimeout(() => {
              if (awaitingAudioRef.current && activeRef.current) {
                console.warn(
                  '[VoiceWS] Timed out waiting for binary WAV audio after agent_response; resuming listening.'
                );
                awaitingAudioRef.current = false;
                returnToListening();
              }
            }, AUDIO_RESPONSE_TIMEOUT_MS);
          }
          break;
        }

        case 'no_speech': {
          const info = String(data.message || 'No speech recognized. Please speak clearly.');
          console.info('[VoiceWS] No speech recognized:', info);
          setNoticeMessage(info);
          returnToListening();
          break;
        }

        case 'error': {
          const errMsg = String(
            data.message ?? data.detail ?? data.error ?? 'Voice assistant returned an error.'
          );
          console.error('[VoiceWS] Server error event:', data);
          setErrorMessage(errMsg);
          returnToListening();
          break;
        }

        default: {
          console.debug('[VoiceWS] Unhandled event type:', eventType, data);
        }
      }
    },
    [returnToListening, setSyncedStatus]
  );

  const connectWebSocket = useCallback(() => {
    if (!activeRef.current) return;

    const wsUrl = getVoiceWebSocketUrl();
    console.info('[VoiceWS] Connecting to:', wsUrl, 'session_id:', sessionIdRef.current);

    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
      } catch {
        // Ignore cleanup error
      }
    }

    manualCloseRef.current = false;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      console.info('[VoiceWS] WebSocket connected:', wsUrl);
    };

    ws.onmessage = async (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        handleJsonEvent(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        await handleBinaryAudioMessage(event.data);
      } else if (event.data instanceof Blob) {
        const buffer = await event.data.arrayBuffer();
        await handleBinaryAudioMessage(buffer);
      } else {
        console.warn('[VoiceWS] Unexpected WebSocket message payload:', event.data);
      }
    };

    ws.onerror = (ev) => {
      console.error('[VoiceWS] WebSocket transport error:', ev);
    };

    ws.onclose = (ev) => {
      console.warn(
        `[VoiceWS] WebSocket closed (code=${ev.code}, clean=${ev.wasClean}, reason="${ev.reason}")`
      );
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      if (manualCloseRef.current || !activeRef.current) {
        return;
      }

      resetTurnState();

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const attempt = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = attempt;
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        setSyncedStatus('reconnecting');
        setErrorMessage(
          `Voice connection lost. Reconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS})...`
        );
        reconnectTimerRef.current = window.setTimeout(() => {
          connectWebSocket();
        }, delayMs);
      } else {
        activeRef.current = false;
        cleanupMedia();
        setErrorMessage(
          'Voice connection lost. Click the microphone button to start a new connection.'
        );
        setSyncedStatus('error');
      }
    };
  }, [cleanupMedia, handleBinaryAudioMessage, handleJsonEvent, resetTurnState, setSyncedStatus]);

  const startVoice = useCallback(async () => {
    // Keep existing active connection running until stopped by clicking X
    if (activeRef.current && statusRef.current !== 'error') {
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setErrorMessage('Microphone capture is not supported in this browser.');
      setSyncedStatus('error');
      return;
    }

    setErrorMessage(null);
    setNoticeMessage(null);
    setSyncedStatus('connecting');
    activeRef.current = true;
    reconnectAttemptsRef.current = 0;

    if (!playerRef.current) {
      playerRef.current = new WavAudioPlayer();
    }
    await playerRef.current.unlock();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (!activeRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API is unavailable in this browser.');
      }

      let captureCtx: AudioContext;
      try {
        captureCtx = new AudioCtx({ sampleRate: TARGET_VOICE_SAMPLE_RATE });
      } catch {
        captureCtx = new AudioCtx();
      }
      if (captureCtx.state === 'suspended') {
        await captureCtx.resume();
      }
      captureCtxRef.current = captureCtx;
      console.info(
        `[VoiceAudio] Capture initialized (hardwareRate=${captureCtx.sampleRate}Hz -> target=${TARGET_VOICE_SAMPLE_RATE}Hz Mono Float32 LE)`
      );

      const source = captureCtx.createMediaStreamSource(stream);
      const processor = captureCtx.createScriptProcessor(4096, 1, 1);
      const silentGain = captureCtx.createGain();
      silentGain.gain.value = 0;

      sourceNodeRef.current = source;
      processorRef.current = processor;
      silentGainRef.current = silentGain;

      processor.onaudioprocess = (audioEvent: AudioProcessingEvent) => {
        if (!activeRef.current) return;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // Strict guard: do NOT listen while analyzing answer, playing AI audio, connecting, or reconnecting
        if (
          vadPhaseRef.current === 'analyzing' ||
          statusRef.current === 'connecting' ||
          statusRef.current === 'processing' ||
          statusRef.current === 'playing_ai' ||
          statusRef.current === 'reconnecting'
        ) {
          return;
        }

        const nowMs = performance.now();
        if (nowMs < echoGuardUntilRef.current) return;

        const rawSamples = audioEvent.inputBuffer.getChannelData(0);
        const resampled = resampleTo16kFloat32(rawSamples, captureCtx.sampleRate);
        const rms = computeRms(resampled);
        const dynamicThreshold = Math.max(0.015, noiseFloorRef.current * 2.8);

        if (vadPhaseRef.current === 'idle') {
          preRollRef.current.push(resampled);
          preRollSamplesCountRef.current += resampled.length;
          while (
            preRollSamplesCountRef.current > PRE_ROLL_MAX_SAMPLES &&
            preRollRef.current.length > 1
          ) {
            const removed = preRollRef.current.shift()!;
            preRollSamplesCountRef.current -= removed.length;
          }

          if (rms > dynamicThreshold) {
            speechOnsetCountRef.current += 1;
            if (speechOnsetCountRef.current >= SPEECH_ONSET_FRAMES) {
              speechOnsetCountRef.current = 0;
              vadPhaseRef.current = 'recording';
              recordedChunksRef.current = [...preRollRef.current, resampled];
              preRollRef.current = [];
              preRollSamplesCountRef.current = 0;
              turnStartTimeRef.current = nowMs;
              lastVoiceTimeRef.current = nowMs;
              setNoticeMessage(null);
              setErrorMessage(null);
              setSyncedStatus('speaking_user');
              console.info('[VoiceAudio] Speech onset detected — recording locally until user stops speaking.');
            }
          } else {
            speechOnsetCountRef.current = 0;
            noiseFloorRef.current = noiseFloorRef.current * 0.95 + Math.min(rms, 0.03) * 0.05;
          }
          return;
        }

        if (vadPhaseRef.current === 'recording') {
          recordedChunksRef.current.push(resampled);

          if (rms > dynamicThreshold * 0.85) {
            lastVoiceTimeRef.current = nowMs;
          }

          const elapsedTurnMs = nowMs - turnStartTimeRef.current;
          const silenceDurationMs = nowMs - lastVoiceTimeRef.current;

          if (
            (elapsedTurnMs >= MIN_TURN_AUDIO_MS && silenceDurationMs >= TRAILING_SILENCE_MS) ||
            elapsedTurnMs >= MAX_TURN_AUDIO_MS
          ) {
            finalizeAndSendRecording();
          }
        }
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(captureCtx.destination);

      connectWebSocket();
    } catch (err) {
      activeRef.current = false;
      cleanupMedia();
      const rawMsg = err instanceof Error ? err.message : String(err);
      const isDenied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      const friendly = isDenied
        ? 'Microphone permission denied. Please allow microphone access in your browser settings.'
        : `Unable to start microphone: ${rawMsg}`;
      console.error('[VoiceAudio] Microphone capture error:', err);
      setErrorMessage(friendly);
      setSyncedStatus('error');
    }
  }, [
    cleanupMedia,
    connectWebSocket,
    finalizeAndSendRecording,
    setSyncedStatus,
  ]);

  const dismissError = useCallback(() => {
    setErrorMessage(null);
    if (statusRef.current === 'reconnecting') {
      stopVoice();
      return;
    }
    if (statusRef.current === 'error') {
      setSyncedStatus('idle');
    }
  }, [setSyncedStatus, stopVoice]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      manualCloseRef.current = true;
      clearTimers();
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'Component unmounted');
        } catch {
          // Ignore unmount close errors
        }
        wsRef.current = null;
      }
      cleanupMedia();
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [cleanupMedia, clearTimers]);

  const resetSession = useCallback(() => {
    sessionIdRef.current = null;
    setSessionId(null);
  }, []);

  return {
    status,
    isVoiceActive: status !== 'idle' && status !== 'error',
    partialTranscript,
    errorMessage,
    noticeMessage,
    sessionId,
    startVoice,
    stopVoice,
    resetSession,
    dismissError,
  };
}
