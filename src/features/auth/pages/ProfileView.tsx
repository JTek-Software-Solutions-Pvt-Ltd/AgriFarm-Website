/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Loader2,
  Lock,
  LogIn,
  MapPin,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  UserCog,
} from 'lucide-react';
import { ActiveTab, UpdateProfileRequestPayload, UserProfile } from '../../../shared/types';
import { useTranslation } from '../../../shared/i18n';
import UserIcon from '../../../shared/assets/account.png';
import { detectCurrentAddress } from '../../../shared/services/geolocation';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import {
  fetchCropList,
  fetchUserProfile,
  openAuthModal,
  saveUserProfile,
  selectAuthUser,
  selectCropOptionsUi,
  selectIsAuthenticated,
  selectProfileUi,
  syncProfileWithLocation,
} from '../store/authSlice';
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY_ISO,
  REGISTRATION_CROP_OPTIONS,
  findCountryByName,
  isValidE164Mobile,
  normalizeFullPhone,
} from '../services/authApi';
import {
  fetchWeatherBundle,
  formatCoords,
  formatLocationLabel,
  resolveManualAddressCoords,
  setWeatherLocation,
} from '../../weather';

interface ProfileViewProps {
  onNavigateTab?: (tab: ActiveTab) => void;
}

interface ProfileFormState {
  name: string;
  email: string;
  mobile: string;
  cropId: number;
  country: string;
  state: string;
  district: string;
  village: string;
  pincode: string;
  avatar: string;
  latitude?: number;
  longitude?: number;
}

function buildInitialFormState(user: UserProfile): ProfileFormState {
  return {
    name: user.name || '',
    email: user.email || '',
    mobile: user.phone || '',
    cropId: user.cropId || 1,
    country: user.country || 'India',
    state: user.state || '',
    district: user.district || '',
    village: user.village || '',
    pincode: user.pincode || '',
    avatar: user.avatar || '',
    latitude: user.latitude,
    longitude: user.longitude,
  };
}

export const ProfileView: React.FC<ProfileViewProps> = memo(({ onNavigateTab }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectAuthUser);
  const { crops, cropsLoading, cropsLoaded, cropsError } = useAppSelector(selectCropOptionsUi);
  const { profileLoading, profileLoaded, profileUpdating, profileError } =
    useAppSelector(selectProfileUi);

  const [form, setForm] = useState<ProfileFormState | null>(() =>
    user ? buildInitialFormState(user) : null
  );
  const [syncWeatherOnSave, setSyncWeatherOnSave] = useState(true);
  const [locatingGps, setLocatingGps] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (!cropsLoaded && !cropsLoading && !cropsError) {
      dispatch(fetchCropList());
    }
  }, [dispatch, cropsLoaded, cropsLoading, cropsError]);

  useEffect(() => {
    if (isAuthenticated && !profileLoaded && !profileLoading && !profileError) {
      dispatch(fetchUserProfile());
    }
  }, [dispatch, isAuthenticated, profileLoaded, profileLoading, profileError]);

  useEffect(() => {
    if (!user) {
      prevUserIdRef.current = null;
      setForm(null);
      return;
    }
    const switchedUser = prevUserIdRef.current !== user.id;
    prevUserIdRef.current = user.id;
    if (switchedUser || !isDirtyRef.current) {
      setForm(buildInitialFormState(user));
      setErrorMsg(null);
    }
  }, [user]);

  const cropOptions = useMemo(() => {
    const base = crops.length > 0 ? crops : REGISTRATION_CROP_OPTIONS;
    if (user?.cropId && user?.primaryCrop && !base.some((c) => c.id === user.cropId)) {
      return [...base, { id: user.cropId, label: user.primaryCrop }];
    }
    return base;
  }, [crops, user?.cropId, user?.primaryCrop]);

  const selectedCropLabel = useMemo(() => {
    const id = form?.cropId ?? user?.cropId;
    return (
      cropOptions.find((c) => c.id === id)?.label ||
      (id === user?.cropId ? user?.primaryCrop : undefined) ||
      'Not selected'
    );
  }, [cropOptions, form?.cropId, user?.cropId, user?.primaryCrop]);

  const isDirty = useMemo(() => {
    if (!user || !form) return false;
    const base = buildInitialFormState(user);
    return (
      form.name !== base.name ||
      form.email !== base.email ||
      form.mobile !== base.mobile ||
      form.cropId !== base.cropId ||
      form.country !== base.country ||
      form.state !== base.state ||
      form.district !== base.district ||
      form.village !== base.village ||
      form.pincode !== base.pincode ||
      form.avatar !== base.avatar ||
      form.latitude !== base.latitude ||
      form.longitude !== base.longitude
    );
  }, [form, user]);

  isDirtyRef.current = isDirty;

  const updateField = useCallback(
    <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => {
      setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
      setErrorMsg(null);
      setSuccessMsg(null);
    },
    []
  );

  const handleAvatarUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please choose a valid image file (PNG, JPG, or WebP).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('Profile image must be under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm((prev) => (prev ? { ...prev, avatar: reader.result as string } : prev));
        setErrorMsg(null);
        setSuccessMsg(null);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const handleCaptureGps = useCallback(async () => {
    if (locatingGps) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setLocatingGps(true);
    try {
      const detected = await detectCurrentAddress();
      const nextLabel =
        detected.label ||
        formatLocationLabel({
          village: detected.village,
          district: detected.district,
          state: detected.state,
          country: detected.country,
          latitude: detected.latitude,
          longitude: detected.longitude,
        });
      const gpsLocation = {
        latitude: detected.latitude,
        longitude: detected.longitude,
        label: nextLabel,
        country: detected.country || undefined,
        state: detected.state || undefined,
        district: detected.district || undefined,
        village: detected.village || undefined,
        pincode: detected.pincode || undefined,
        source: 'gps' as const,
      };

      setForm((prev) =>
        prev
          ? {
              ...prev,
              country: detected.country || prev.country || 'India',
              state: detected.state || prev.state,
              district: detected.district || prev.district,
              village: detected.village || prev.village,
              pincode: detected.pincode || prev.pincode,
              latitude: detected.latitude,
              longitude: detected.longitude,
            }
          : prev
      );

      if (syncWeatherOnSave) {
        dispatch(setWeatherLocation(gpsLocation));
      }

      if (!isDirtyRef.current) {
        const synced = await dispatch(syncProfileWithLocation(gpsLocation)).unwrap();
        setSuccessMsg(synced ? t('profile.savedSuccess') : t('auth.addressDetected'));
      } else {
        setSuccessMsg(t('auth.addressDetected'));
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : 'Unable to detect your GPS location.'
      );
    } finally {
      setLocatingGps(false);
    }
  }, [dispatch, locatingGps, syncWeatherOnSave, t]);

  const handleDiscard = useCallback(() => {
    if (!user) return;
    setForm(buildInitialFormState(user));
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [user]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user || !form || profileUpdating) return;

      const trimmedName = form.name.trim();
      if (trimmedName.length < 2) {
        setErrorMsg('Please enter your full name (at least 2 characters).');
        return;
      }

      const trimmedEmail = form.email.trim();
      if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        setErrorMsg('Please enter a valid email address.');
        return;
      }

      const countryIso = findCountryByName(form.country)?.iso || DEFAULT_COUNTRY_ISO;
      const normalizedMobile = normalizeFullPhone(form.mobile || user.phone, countryIso);
      if (!isValidE164Mobile(normalizedMobile)) {
        setErrorMsg('Please enter a valid mobile number with country code (e.g. +919876543210).');
        return;
      }

      const isIndia = form.country.trim().toLowerCase() === 'india';
      const trimmedPin = form.pincode.trim();
      if (trimmedPin) {
        if (isIndia && !/^\d{6}$/.test(trimmedPin)) {
          setErrorMsg('Please enter a valid 6-digit Indian pincode.');
          return;
        }
        if (!isIndia && !/^[A-Za-z0-9\s-]{3,10}$/.test(trimmedPin)) {
          setErrorMsg('Please enter a valid postal code (3–10 characters).');
          return;
        }
      }

      setErrorMsg(null);
      setSuccessMsg(null);

      const nextVillage = form.village.trim();
      const nextDistrict = form.district.trim();
      const nextState = form.state.trim();
      const nextCountry = form.country.trim() || 'India';

      const hasExplicitCoords =
        typeof form.latitude === 'number' &&
        Number.isFinite(form.latitude) &&
        typeof form.longitude === 'number' &&
        Number.isFinite(form.longitude);

      const apiPayload: UpdateProfileRequestPayload = {
        full_name: trimmedName,
        photo_url: form.avatar.trim() || null,
        email: trimmedEmail || null,
        mobile: normalizedMobile,
        crop_id: Number(form.cropId) || 1,
        country: nextCountry,
        state: nextState,
        district: nextDistrict,
        ...(nextVillage ? { village: nextVillage } : {}),
        pincode: trimmedPin,
        latitude: hasExplicitCoords ? form.latitude! : null,
        longitude: hasExplicitCoords ? form.longitude! : null,
      };

      const selectedCropName =
        cropOptions.find((c) => c.id === apiPayload.crop_id)?.label || user.primaryCrop;

      try {
        const result = await dispatch(
          saveUserProfile({
            apiPayload,
            localOverrides: {
              primaryCrop: selectedCropName,
            },
          })
        ).unwrap();

        isDirtyRef.current = false;
        setForm(buildInitialFormState(result.user));
        setSuccessMsg(result.message || t('profile.savedSuccess'));

        if (syncWeatherOnSave) {
          const rawUserId =
            (result.user.rawId || result.user.id.replace(/^farmer-/, '')).trim() || undefined;

          if (hasExplicitCoords && form.latitude !== undefined && form.longitude !== undefined) {
            const label = formatLocationLabel({
              village: nextVillage,
              district: nextDistrict,
              state: nextState,
              country: nextCountry,
              latitude: form.latitude,
              longitude: form.longitude,
            });
            dispatch(
              setWeatherLocation({
                latitude: form.latitude,
                longitude: form.longitude,
                label,
                state: nextState || undefined,
                district: nextDistrict || undefined,
                village: nextVillage || undefined,
                pincode: trimmedPin || undefined,
                source: 'profile',
              })
            );
            const nextStationId =
              (result.user.imdStationId || result.user.cityForecastStationCode || '').trim() ||
              undefined;
            dispatch(
              fetchWeatherBundle({
                userId: rawUserId,
                latitude: form.latitude,
                longitude: form.longitude,
                stationId: nextStationId,
                force: true,
              })
            );
          } else if (nextVillage || nextDistrict || nextState || trimmedPin) {
            const addressQuery = [nextVillage, nextDistrict, nextState, trimmedPin, nextCountry]
              .filter(Boolean)
              .join(', ');
            try {
              const resolved = await dispatch(
                resolveManualAddressCoords({
                  addressQuery,
                  state: nextState || undefined,
                  district: nextDistrict || undefined,
                  village: nextVillage || undefined,
                  pincode: trimmedPin || undefined,
                  country: nextCountry,
                })
              ).unwrap();

              if (resolved) {
                const nextStationId =
                  (result.user.imdStationId || result.user.cityForecastStationCode || '').trim() ||
                  undefined;
                dispatch(setWeatherLocation(resolved));
                dispatch(
                  fetchWeatherBundle({
                    userId: rawUserId,
                    latitude: resolved.latitude,
                    longitude: resolved.longitude,
                    stationId: nextStationId,
                    force: true,
                  })
                );
              }
            } catch {
              // Ignore skipped or transient geocoding errors; profile changes are already persisted
            }
          }
        }
      } catch (err) {
        setErrorMsg(
          typeof err === 'string' && err
            ? err
            : err instanceof Error && err.message
              ? err.message
              : 'Unable to update profile on the server.'
        );
      }
    },
    [cropOptions, dispatch, form, profileUpdating, syncWeatherOnSave, t, user]
  );

  if (!isAuthenticated || !user || !form) {
    return (
      <div className="max-w-3xl mx-auto py-8 animate-in fade-in duration-300">
        <div className="bg-white rounded-2xl border border-[#e5ebe7] p-8 sm:p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#f0f7f2] text-[#113e2e] mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h1 className="text-xl font-bold font-serif text-[#14382d]">
              {t('profile.signInRequired')}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {t('profile.signInRequiredSub')}
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => dispatch(openAuthModal())}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#113e2e] hover:bg-[#0a291f] text-white text-xs sm:text-sm font-bold transition cursor-pointer"
            >
              <LogIn className="w-4 h-4 text-[#e5b54f]" />
              <span>{t('auth.signIn')}</span>
            </button>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('overview')}
                className="px-4 py-2.5 rounded-xl border border-[#d5e7db] bg-white hover:bg-[#f8faf8] text-xs sm:text-sm font-semibold text-slate-700 transition cursor-pointer"
              >
                {t('nav.overview')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <span>{t('header.farmWorkspace')}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#175638] font-semibold">{t('nav.profile')}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-serif text-[#14382d] mt-1 flex items-center gap-2.5">
            <UserCog className="w-6 h-6 text-[#175638] shrink-0" />
            <span>{t('profile.title')}</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{t('profile.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              isDirtyRef.current = false;
              dispatch(fetchUserProfile({ force: true }));
            }}
            disabled={profileLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#d5e7db] bg-white hover:bg-[#f0f7f2] disabled:opacity-60 text-xs font-semibold text-[#113e2e] transition whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#175638] ${profileLoading ? 'animate-spin' : ''}`} />
            <span>{profileLoading ? 'Syncing...' : 'Sync Profile'}</span>
          </button>

          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('overview')}
              className="px-4 py-2 rounded-xl border border-[#d5e7db] bg-white hover:bg-[#f0f7f2] text-xs font-semibold text-[#113e2e] transition whitespace-nowrap shrink-0 cursor-pointer"
            >
              Back to Overview
            </button>
          )}
        </div>
      </div>

      {/* Main Two-Column Profile Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Farmer Identity Card */}
        <aside className="lg:col-span-4 bg-white rounded-2xl border border-[#e5ebe7] p-6 space-y-5">
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <img
                src={form.avatar || UserIcon}
                alt={form.name || user.name}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  if (e.currentTarget.src !== UserIcon) {
                    e.currentTarget.src = UserIcon;
                  }
                }}
                className="w-24 h-24 rounded-full object-cover bg-[#e7f2e8] border border-[#cde1d2]"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload profile photo"
                title="Change profile photo"
                className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#113e2e] hover:bg-[#0a291f] text-white flex items-center justify-center border-2 border-white transition cursor-pointer"
              >
                <Camera className="w-4 h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </div>

            <h2 className="mt-3 text-base font-bold text-[#14382d]">{form.name || user.name}</h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums notranslate" translate="no">
              {user.phone}
            </p>
            <p className="text-xs text-slate-600 mt-1">
              {[form.village, form.district, form.state].filter(Boolean).join(', ') ||
                user.location}
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg border border-[#d5e7db] bg-[#f8faf7] hover:bg-[#e1efe6] text-[11px] font-semibold text-[#113e2e] transition cursor-pointer"
              >
                Change Photo
              </button>
              {form.avatar && (
                <button
                  type="button"
                  onClick={() => updateField('avatar', '')}
                  aria-label="Remove custom photo"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-semibold text-slate-600 transition cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
            </div>
          </div>

          <dl className="border-t border-slate-100 pt-4 divide-y divide-slate-100 text-xs">
            <div className="py-2.5 flex items-center justify-between gap-3">
              <dt className="text-slate-500">{t('auth.cropLabel')}</dt>
              <dd className="font-semibold text-slate-900 text-right truncate max-w-[170px]">
                {selectedCropLabel}
              </dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-3">
              <dt className="text-slate-500">{t('auth.countryLabel')}</dt>
              <dd className="font-semibold text-slate-900 text-right truncate max-w-[170px]">
                {form.country || '—'}
              </dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-3">
              <dt className="text-slate-500">{t('auth.pincodeLabel')}</dt>
              <dd className="font-semibold text-slate-900 tabular-nums">{form.pincode || '—'}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-3">
              <dt className="text-slate-500">Coordinates</dt>
              <dd
                className="font-mono text-[11px] font-semibold text-slate-800 tabular-nums text-right truncate max-w-[170px] notranslate"
                translate="no"
              >
                {typeof form.latitude === 'number' && typeof form.longitude === 'number'
                  ? formatCoords(form.latitude, form.longitude)
                  : 'Not captured'}
              </dd>
            </div>
          </dl>
        </aside>

        {/* Right Column: Editable Form */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-8 bg-white rounded-2xl border border-[#e5ebe7] p-6 space-y-6"
        >
          {/* Section 1: Personal & Contact Information */}
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-[#14382d]">Personal &amp; Contact Details</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Used across farm greetings, KVK reports, and advisory notifications.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="profile-name"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {t('auth.fullNameLabel')} *
                </label>
                <input
                  id="profile-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder={t('auth.fullNamePlaceholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:ring-2 focus:ring-[#113e2e]/15 focus:outline-none text-xs sm:text-sm font-medium text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-email"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {t('auth.emailLabel')}
                </label>
                <input
                  id="profile-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:ring-2 focus:ring-[#113e2e]/15 focus:outline-none text-xs sm:text-sm font-medium text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-phone"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {t('auth.mobileLabel')}
                </label>
                <input
                  id="profile-phone"
                  type="tel"
                  value={form.mobile}
                  onChange={(e) => updateField('mobile', e.target.value)}
                  placeholder="+919876543210"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:ring-2 focus:ring-[#113e2e]/15 focus:outline-none text-xs sm:text-sm font-medium text-slate-900 tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-crop"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {t('auth.cropLabel')}
                </label>
                <select
                  id="profile-crop"
                  value={form.cropId}
                  onChange={(e) => updateField('cropId', Number(e.target.value))}
                  disabled={cropsLoading && cropOptions.length === 0}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:ring-2 focus:ring-[#113e2e]/15 focus:outline-none text-xs sm:text-sm font-medium text-slate-900 cursor-pointer"
                >
                  {cropOptions.map((crop) => (
                    <option key={crop.id} value={crop.id}>
                      {crop.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Section 2: Farm Location & GPS */}
          <section className="pt-5 border-t border-slate-100 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#14382d]">{t('auth.farmAddressLabel')}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Location fields calibrate mandi yards, disease risk advisories, and forecasts.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCaptureGps}
                disabled={locatingGps}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#f0f7f2] hover:bg-[#e1efe6] border border-[#cbe1d2] text-xs font-bold text-[#113e2e] transition disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
              >
                {locatingGps ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#175638]" />
                ) : (
                  <MapPin className="w-3.5 h-3.5 text-[#175638]" />
                )}
                <span>
                  {locatingGps ? t('auth.detectingAddress') : t('auth.useCurrentAddress')}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="profile-country"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {t('auth.countryLabel')}
                </label>
                <select
                  id="profile-country"
                  value={form.country}
                  onChange={(e) => updateField('country', e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:ring-2 focus:ring-[#113e2e]/15 focus:outline-none text-xs sm:text-sm font-medium text-slate-900 cursor-pointer"
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.iso} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="profile-state"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {t('auth.stateLabel')}
                </label>
                <input
                  id="profile-state"
                  type="text"
                  value={form.state}
                  onChange={(e) => updateField('state', e.target.value)}
                  placeholder="e.g. Andhra Pradesh"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:ring-2 focus:ring-[#113e2e]/15 focus:outline-none text-xs sm:text-sm font-medium text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-district"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {t('auth.districtLabel')}
                </label>
                <input
                  id="profile-district"
                  type="text"
                  value={form.district}
                  onChange={(e) => updateField('district', e.target.value)}
                  placeholder="e.g. Guntur"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:ring-2 focus:ring-[#113e2e]/15 focus:outline-none text-xs sm:text-sm font-medium text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-village"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {t('auth.villageLabel')}
                </label>
                <input
                  id="profile-village"
                  type="text"
                  value={form.village}
                  onChange={(e) => updateField('village', e.target.value)}
                  placeholder="e.g. Tenali"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:ring-2 focus:ring-[#113e2e]/15 focus:outline-none text-xs sm:text-sm font-medium text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-pincode"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {t('auth.pincodeLabel')}
                </label>
                <input
                  id="profile-pincode"
                  type="text"
                  value={form.pincode}
                  onChange={(e) => updateField('pincode', e.target.value)}
                  placeholder="e.g. 522001"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:ring-2 focus:ring-[#113e2e]/15 focus:outline-none text-xs sm:text-sm font-medium text-slate-900 tabular-nums"
                />
              </div>

              <div className="flex flex-col justify-end">
                <span className="text-[11px] font-semibold text-slate-500">Captured GPS</span>
                <span
                  className="mt-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-mono text-slate-700 tabular-nums truncate notranslate"
                  translate="no"
                >
                  {typeof form.latitude === 'number' && typeof form.longitude === 'number'
                    ? formatCoords(form.latitude, form.longitude)
                    : 'Not captured'}
                </span>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={syncWeatherOnSave}
                onChange={(e) => setSyncWeatherOnSave(e.target.checked)}
                className="w-4 h-4 rounded border-[#cbe1d2] text-[#113e2e] focus:ring-[#113e2e]"
              />
              <span>Also update active Weather Hub forecast location when saving address</span>
            </label>
          </section>

          {/* Status Feedback */}
          {(errorMsg || profileError) && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700"
            >
              {errorMsg || profileError}
            </div>
          )}

          {successMsg && !errorMsg && (
            <div
              role="status"
              className="p-3.5 rounded-xl bg-[#f0f7f2] border border-[#cbe1d2] text-xs font-semibold text-[#113e2e] flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-[#175638] shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Action Footer */}
          <div className="pt-5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {isDirty ? 'You have unsaved profile changes.' : 'All profile changes are saved.'}
            </span>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleDiscard}
                disabled={!isDirty || profileUpdating}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-45 text-xs font-semibold text-slate-700 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('profile.discardChanges')}</span>
              </button>

              <button
                type="submit"
                disabled={profileUpdating}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#113e2e] hover:bg-[#0a291f] disabled:opacity-60 text-white text-xs sm:text-sm font-bold shadow-xs transition cursor-pointer whitespace-nowrap shrink-0"
              >
                {profileUpdating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 text-[#e5b54f]" />
                )}
                <span>{profileUpdating ? 'Saving...' : t('profile.saveProfile')}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
});
