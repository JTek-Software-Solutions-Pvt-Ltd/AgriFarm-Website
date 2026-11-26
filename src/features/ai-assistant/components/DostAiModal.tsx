/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, Mic, Bot, User, ArrowRight, Camera, Volume2, AlertCircle, Send } from 'lucide-react';
import { ActiveTab, AiChatMessage, Language } from '../../../shared/types';
import { useTranslation } from '../../../shared/i18n';
import { useAppSelector } from '../../../app/store/hooks';
import { selectAuthUser, selectIsAuthenticated } from '../../auth';
import { selectWeatherUi } from '../../weather';
import { formatLiveClockTime } from '../../../shared/utils/dateTime';
import { useVoiceToVoice, VoiceAgentEvent } from '../hooks/useVoiceToVoice';
import { sendAiChatMessageApi } from '../services/chatApi';

interface DostAiModalProps {
  isOpen: boolean;
  onClose: () => void;
  setActiveTab?: (tab: ActiveTab) => void;
  language?: Language;
  onOpenScan?: () => void;
  initialSessionId?: string | null;
  welcomeMessage?: string | null;
}

function mapIntentToActions(intent?: string): Array<{ label: string; tab: ActiveTab }> | undefined {
  if (!intent) return undefined;
  const normalized = intent.toLowerCase();
  if (normalized === 'weather') {
    return [{ label: 'Open Weather Advisory', tab: 'weather' }];
  }
  if (normalized === 'crop') {
    return [{ label: 'Open Crop Doctor', tab: 'crop-doctor' }];
  }
  if (normalized === 'market') {
    return [{ label: 'View Mandi Prices', tab: 'market-prices' }];
  }
  return undefined;
}

export const DostAiModal: React.FC<DostAiModalProps> = ({
  isOpen,
  onClose,
  setActiveTab = () => {},
  onOpenScan,
  initialSessionId = null,
  welcomeMessage = null,
}) => {
  const { t, language, currentLanguage } = useTranslation();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectAuthUser);
  const { location: weatherLocation } = useAppSelector(selectWeatherUi);
  const farmerName = isAuthenticated && user ? user.name : 'Farmer';
  const activeDistrict =
    weatherLocation.district ||
    user?.district ||
    weatherLocation.label.split(',')[0].trim() ||
    'Your Region';

  const getLocalizedGreeting = useCallback((): string => {
    const code = language.toLowerCase();
    if (!isAuthenticated || !user) {
      if (code === 'te') {
        return 'నమస్కారం! వాతావరణ సూచనలు, పంట తెగుళ్ల నివారణ మరియు మార్కెట్ ధరల గురించి మీకు ఏ వ్యవసాయ సలహా కావాలి?';
      }
      if (code === 'hi') {
        return 'नमस्ते! मौसम पूर्वानुमान, फसल रोग निवारण और मंडी भाव के बारे में आज मैं आपकी क्या सहायता कर सकता हूँ?';
      }
      return `Namaste! Ask me about seasonal crop management, weather advisories, pest symptoms, or mandi market prices in ${currentLanguage.nativeName} (${currentLanguage.name}).`;
    }

    if (code === 'te') {
      return `నమస్కారం ${farmerName} గారు! ${activeDistrict} ప్రాంత వాతావరణం మరియు మీ పంటల స్థితిని దృష్టిలో ఉంచుకుని నేను సహాయం చేయడానికి సిద్ధంగా ఉన్నాను. ఈ రోజు మీకు ఏ వ్యవసాయ సలహా కావాలి?`;
    }
    if (code === 'hi') {
      return `नमस्ते ${farmerName} जी! ${activeDistrict} के मौसम और आपकी फसलों की स्थिति के अनुसार मैं आपकी सहायता के लिए तैयार हूँ। आज मैं आपकी क्या मदद कर सकता हूँ?`;
    }
    if (code === 'ta') {
      return `வணக்கம் ${farmerName}! ${activeDistrict} வானிலை மற்றும் உங்கள் பயிர் நிலவரத்திற்கேற்ப ஆலோசனை வழங்கத் தயாராக உள்ளேன். இன்று உங்களுக்கு என்ன உதவி தேவை?`;
    }
    if (code === 'kn') {
      return `ನಮಸ್ಕಾರ ${farmerName}! ${activeDistrict} ಹವಾಮಾನ ಮತ್ತು ನಿಮ್ಮ ಬೆಳೆಗಳ ಮಾಹಿತಿಗೆ ಅನುಗುಣವಾಗಿ ಸಹಾಯ ಮಾಡಲು ಸಿದ್ಧನಿದ್ದೇನೆ. ಇಂದು ನಿಮಗೆ ಯಾವ ಕೃಷಿ ಸಲಹೆ ಬೇಕು?`;
    }
    if (code === 'mr') {
      return `नमस्कार ${farmerName} जी! ${activeDistrict} मधील हवामान आणि आपल्या पिकांच्या स्थितीनुसार मी मदतीसाठी तयार आहे. आज मी आपल्याला काय मदत करू शकेन?`;
    }
    if (code === 'bn') {
      return `নমস্কার ${farmerName}! ${activeDistrict}-এর আবহাওয়া ও আপনার ফসলের অবস্থা অনুযায়ী সাহায্য করতে আমি প্রস্তুত। আজ আপনাকে কী কৃষি পরামর্শ দিতে পারি?`;
    }

    return `Namaste ${farmerName}! I am ready to help with farm weather advisories, crop protection, irrigation, and market prices around ${activeDistrict}. How can I assist your farm today?`;
  }, [activeDistrict, currentLanguage.name, currentLanguage.nativeName, farmerName, isAuthenticated, language, user]);

  const suggestedQuestions = useMemo(() => {
    const code = language.toLowerCase();
    const cropLabel = user?.primaryCrop || 'my crop';
    if (code === 'te') {
      return [
        `${activeDistrict} వాతావరణం ఎలా ఉంటుంది?`,
        `${cropLabel} పంటకు పురుగు మందు ఎప్పుడు పిచికారీ చేయాలి?`,
        'ఈరోజు నీటిపారుదల మరియు ఎరువుల సూచన ఇవ్వండి',
      ];
    }
    if (code === 'hi') {
      return [
        `${activeDistrict} में आज और कल का मौसम कैसा रहेगा?`,
        `${cropLabel} की फसल में कीट नियंत्रण कब करें?`,
        'सिंचाई और खाद डालने का सही समय बताएं',
      ];
    }
    return [
      `What is the weather forecast for ${activeDistrict}?`,
      `Best spraying & irrigation advice for ${cropLabel}?`,
      'How should I protect crops from fungal disease?',
    ];
  }, [activeDistrict, language, user?.primaryCrop]);

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [inputValue, setInputValue] = useState('');
  const [textSending, setTextSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(initialSessionId ?? null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const wasOpenRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const syncSessionId = useCallback((nextId: string | null) => {
    const cleaned = nextId?.trim() || null;
    sessionIdRef.current = cleaned;
    setSessionId(cleaned);
  }, []);

  const numericUserId = Number(user?.rawId || user?.id);
  const voiceUserId = Number.isInteger(numericUserId) && numericUserId > 0 ? numericUserId : 1;

  const handleVoiceFinalTranscript = useCallback((transcript: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `user-voice-${Date.now()}`,
        sender: 'user',
        text: transcript,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  }, []);

  const handleVoiceAgentResponse = useCallback((event: VoiceAgentEvent) => {
    const actions = mapIntentToActions(event.intent);

    setMessages((prev) => [
      ...prev,
      {
        id: `ai-voice-${Date.now()}`,
        sender: 'assistant',
        text: event.text || 'Voice advisory received.',
        timestamp: `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${
          event.intent ? ` • ${event.intent}` : ''
        }`,
        actions,
      },
    ]);
  }, []);

  const {
    status: voiceStatus,
    isVoiceActive,
    partialTranscript,
    errorMessage: voiceError,
    noticeMessage: voiceNotice,
    startVoice,
    stopVoice,
    resetSession,
    dismissError: dismissVoiceError,
  } = useVoiceToVoice({
    language,
    userId: voiceUserId,
    locationName: weatherLocation.label || activeDistrict,
    latitude: weatherLocation.latitude,
    longitude: weatherLocation.longitude,
    initialSessionId: sessionId,
    onSessionIdChange: syncSessionId,
    onFinalTranscript: handleVoiceFinalTranscript,
    onAgentResponse: handleVoiceAgentResponse,
  });

  // Initialize fresh conversation & optional welcome session on open; clear cleanly on leave/close
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      const incomingSessionId = initialSessionId?.trim() || null;
      syncSessionId(incomingSessionId);
      setInputValue('');
      setChatError(null);
      setTextSending(false);
      const initialText = welcomeMessage?.trim() ? welcomeMessage.trim() : getLocalizedGreeting();
      setMessages([
        {
          id: 'msg-initial',
          sender: 'assistant',
          text: initialText,
          timestamp: formatLiveClockTime(new Date()),
        },
      ]);
      return;
    }

    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      if (chatAbortRef.current) {
        chatAbortRef.current.abort();
        chatAbortRef.current = null;
      }
      stopVoice();
      resetSession();
      syncSessionId(null);
      setInputValue('');
      setChatError(null);
      setTextSending(false);
      setMessages([]);
    }
  }, [getLocalizedGreeting, initialSessionId, isOpen, resetSession, stopVoice, syncSessionId, welcomeMessage]);

  useEffect(() => {
    return () => {
      if (chatAbortRef.current) {
        chatAbortRef.current.abort();
        chatAbortRef.current = null;
      }
    };
  }, []);

  // Keep latest transcript & AI response visible in chat feed
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, partialTranscript, voiceStatus, textSending]);

  const handleSendTextMessage = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed || textSending) return;

      setChatError(null);
      setInputValue('');
      setTextSending(true);

      const userMsgId = `user-text-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          sender: 'user',
          text: trimmed,
          timestamp: formatLiveClockTime(new Date()),
        },
      ]);

      if (chatAbortRef.current) {
        chatAbortRef.current.abort();
      }
      const controller = new AbortController();
      chatAbortRef.current = controller;

      try {
        const res = await sendAiChatMessageApi(
          {
            user_id: voiceUserId,
            message: trimmed,
            language: (language || 'en').toLowerCase(),
            location_name: weatherLocation.label || activeDistrict || null,
            latitude: Number.isFinite(weatherLocation.latitude) ? weatherLocation.latitude : null,
            longitude: Number.isFinite(weatherLocation.longitude) ? weatherLocation.longitude : null,
            session_id: sessionIdRef.current,
          },
          controller.signal
        );

        if (res.session_id) {
          syncSessionId(res.session_id);
        }

        const actions = mapIntentToActions(res.intent);
        setMessages((prev) => [
          ...prev,
          {
            id: `ai-text-${Date.now()}`,
            sender: 'assistant',
            text: res.response_text,
            timestamp: `${formatLiveClockTime(new Date())}${res.intent ? ` • ${res.intent}` : ''}`,
            actions,
          },
        ]);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const msg = err instanceof Error ? err.message : 'Unable to send message to Dost AI.';
        setChatError(msg);
      } finally {
        if (chatAbortRef.current === controller) {
          chatAbortRef.current = null;
        }
        setTextSending(false);
      }
    },
    [
      activeDistrict,
      language,
      syncSessionId,
      textSending,
      voiceUserId,
      weatherLocation.label,
      weatherLocation.latitude,
      weatherLocation.longitude,
    ]
  );

  if (!isOpen) return null;

  const voiceStatusLabel = (() => {
    switch (voiceStatus) {
      case 'connecting':
        return 'Requesting mic & connecting voice session...';
      case 'listening':
        return 'Connected & listening continuously — speak naturally';
      case 'speaking_user':
        return 'Recording your voice (will send when you pause)...';
      case 'processing':
        return 'Analyzing your question (mic paused)...';
      case 'playing_ai':
        return 'Playing AI answer (mic paused)...';
      case 'reconnecting':
        return 'Connection lost — reconnecting voice session...';
      default:
        return voiceNotice || '';
    }
  })();

  return (
    <div
      aria-modal="true"
      role="dialog"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-2xl w-full h-[640px] flex flex-col shadow-2xl overflow-hidden relative border border-[#d5e7db]">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-[#113e2e] to-[#1b5e40] text-white p-4 sm:p-5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-[#e5b54f] border border-white/20">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold font-serif">{t('modals.dostAiTitle')}</h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-200 text-[10px] font-bold uppercase tracking-wider border border-emerald-400/30 flex items-center gap-1">
                  <span>{currentLanguage.flag || '🌐'}</span>
                  <span>{currentLanguage.nativeName}</span>
                </span>
              </div>
              <p className="text-xs text-emerald-200 flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-[#3fb968] animate-pulse"></span>
                <span>{t('modals.dostAiStatus')}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenScan && (
              <button
                onClick={onOpenScan}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white border border-white/20 transition"
              >
                <Camera className="w-4 h-4 text-[#e5b54f]" />
                <span>{t('overview.scanAction')}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/15 text-white/80 hover:text-white transition"
              aria-label="Close Assistant"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-[#f8faf8]">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${
                msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs shrink-0 ${
                  msg.sender === 'user'
                    ? 'bg-[#1b5e40] text-white'
                    : 'bg-emerald-100 text-[#113e2e] border border-emerald-200'
                }`}
              >
                {msg.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[82%] sm:max-w-[75%] rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-[#113e2e] text-white rounded-tr-xs shadow-xs'
                    : 'bg-white text-slate-800 rounded-tl-xs border border-[#dce7de] shadow-xs'
                }`}
              >
                <p className="whitespace-pre-line">{msg.text}</p>
                <div
                  className={`mt-1 text-[10px] ${
                    msg.sender === 'user' ? 'text-emerald-200 text-right' : 'text-slate-400'
                  }`}
                >
                  {msg.timestamp}
                </div>

                {/* Interactive Action Shortcuts attached to AI message */}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-[#eaf2eb] flex flex-wrap gap-2">
                    {msg.actions.map((act, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          if (act.tab) {
                            setActiveTab(act.tab);
                            onClose();
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[#f0f7f2] hover:bg-[#e0efe3] text-[#113e2e] text-xs font-semibold border border-[#cbe1d2] transition flex items-center gap-1 group"
                      >
                        <span>{act.label}</span>
                        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {(partialTranscript || voiceStatus === 'speaking_user') && (
            <div className="flex items-start gap-3 flex-row-reverse">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs shrink-0 bg-[#1b5e40] text-white">
                <User className="w-4 h-4" />
              </div>
              <div
                className="max-w-[82%] sm:max-w-[75%] rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed bg-[#113e2e]/85 text-white rounded-tr-xs shadow-xs notranslate"
                translate="no"
              >
                <p className="whitespace-pre-line italic">
                  {partialTranscript || 'Listening...'}
                </p>
                <div className="mt-1 text-[10px] text-emerald-200 text-right">Live transcript</div>
              </div>
            </div>
          )}

          {(voiceStatus === 'processing' || textSending) && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-[#113e2e] flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 animate-spin" />
              </div>
              <div
                className="bg-white rounded-2xl rounded-tl-xs p-3 text-xs text-slate-500 border border-[#dce7de] flex items-center gap-1.5 shadow-xs notranslate"
                translate="no"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#113e2e] animate-bounce"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#113e2e] animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#113e2e] animate-bounce [animation-delay:0.4s]"></span>
                <span className="ml-1 text-[11px] text-slate-600 font-medium">
                  {voiceStatus === 'processing'
                    ? 'Dost AI is analyzing your voice...'
                    : 'Dost AI is thinking...'}
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Quick Questions + Text Input + Voice Chat Controls */}
        <div className="p-3 sm:p-4 bg-white border-t border-[#dce7de] space-y-2.5">
          {/* Quick Questions Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0 mr-1">
              {t('modals.quickQuestions') || 'Quick Questions:'}
            </span>
            {suggestedQuestions.map((q) => (
              <button
                key={q}
                type="button"
                disabled={textSending}
                onClick={() => {
                  void handleSendTextMessage(q);
                }}
                className="px-3 py-1 rounded-full bg-[#f4f8f5] hover:bg-[#e5f1e8] text-[#113e2e] text-[11px] font-medium border border-[#d5e7db] whitespace-nowrap transition shrink-0 cursor-pointer disabled:opacity-60"
              >
                {q}
              </button>
            ))}
          </div>

          {(voiceError || chatError) && (
            <div
              role="alert"
              className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center justify-between gap-2 notranslate"
              translate="no"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span className="truncate">{voiceError || chatError}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (voiceError) dismissVoiceError();
                  if (chatError) setChatError(null);
                }}
                className="text-red-500 hover:text-red-700 p-0.5 shrink-0"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {!voiceError && (isVoiceActive || voiceNotice) && (
            <div
              role="status"
              className="px-3 py-1.5 rounded-xl bg-[#f0f7f2] border border-[#cde0d1] text-[#113e2e] text-xs flex items-center justify-between gap-2 notranslate"
              translate="no"
            >
              <div className="flex items-center gap-2 min-w-0">
                {voiceStatus === 'playing_ai' ? (
                  <Volume2 className="w-4 h-4 shrink-0 text-[#1b5e40] animate-pulse" />
                ) : (
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      voiceStatus === 'speaking_user'
                        ? 'bg-red-500 animate-ping'
                        : voiceStatus === 'reconnecting' || voiceStatus === 'processing'
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-[#1b5e40] animate-pulse'
                    }`}
                  />
                )}
                <span className="truncate font-medium">
                  {voiceNotice && voiceStatus === 'listening' ? voiceNotice : voiceStatusLabel}
                </span>
              </div>
            </div>
          )}

          {/* Unified Voice + Text Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendTextMessage(inputValue);
            }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => {
                void startVoice();
              }}
              className={`p-2.5 sm:p-3 rounded-xl border transition flex items-center justify-center gap-1.5 shrink-0 shadow-xs cursor-pointer ${
                isVoiceActive
                  ? 'bg-[#113e2e] text-[#e5b54f] border-[#113e2e] ring-2 ring-emerald-400/40'
                  : 'bg-[#f4f8f5] hover:bg-[#e5f1e8] text-[#113e2e] border-[#cbe1d2]'
              }`}
              title={
                isVoiceActive
                  ? 'Voice session active (click Stop X to end)'
                  : 'Start Voice Chat'
              }
              aria-label={isVoiceActive ? 'Voice session active' : 'Start voice chat'}
            >
              <Mic className={`w-4 h-4 ${isVoiceActive ? 'animate-pulse' : ''}`} />
              <span className="hidden sm:inline text-xs font-bold">
                {isVoiceActive
                  ? voiceStatus === 'speaking_user'
                    ? 'Listening'
                    : voiceStatus === 'processing'
                      ? 'Analyzing'
                      : voiceStatus === 'playing_ai'
                        ? 'Speaking'
                        : 'Live'
                  : 'Voice'}
              </span>
            </button>

            {isVoiceActive && (
              <button
                type="button"
                onClick={stopVoice}
                className="p-2.5 sm:p-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition shadow-xs shrink-0 cursor-pointer"
                title="Stop voice chat"
                aria-label="Stop voice chat"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={
                t('modals.dostAiPlaceholder') ||
                'Ask about weather, crops, pests, or mandi prices...'
              }
              disabled={textSending}
              className="flex-1 min-w-0 px-3.5 py-2.5 sm:py-3 rounded-xl border border-[#cde0d1] bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1b5e40]/30 focus:border-[#1b5e40] disabled:bg-slate-50"
            />

            <button
              type="submit"
              disabled={textSending || !inputValue.trim()}
              className="p-2.5 sm:p-3 rounded-xl bg-[#113e2e] hover:bg-[#0a291f] text-white transition shadow-xs shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Send message"
              title="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
