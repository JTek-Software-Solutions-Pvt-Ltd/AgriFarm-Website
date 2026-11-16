/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAsyncThunk, createSelector, createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  CropOptionItem,
  RegisterRequestPayload,
  UpdateProfileRequestPayload,
  UserProfile,
} from '../../../shared/types';
import {
  AUTH_API_BASE_URL,
  AUTH_ENDPOINTS,
  AUTH_REQUEST_HEADERS,
  DEFAULT_COUNTRY_ISO,
  extractJwtToken,
  findCountryByDialCode,
  findCountryByName,
  formatPhoneForDisplay,
  isValidE164Mobile,
  mapApiUserToProfile,
  normalizeFullPhone,
  resolveNumericUserId,
} from '../services/authApi';
import {
  clearAuthStorage,
  decodeJwtPayload,
  getAuthHeaders,
  getStoredJwt,
  getStoredUser,
  saveAuthStorage,
} from '../utils/jwt';

export type AuthStep = 'mobile' | 'register' | 'otp';
export type OtpOrigin = 'login' | 'register';

export interface AuthState {
  user: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
  isAuthModalOpen: boolean;
  authStep: AuthStep;
  otpOrigin: OtpOrigin;
  pendingPhone: string; // Canonical E.164 format e.g. +919553737309
  pendingCountryIso: string; // e.g. 'IN' default
  pendingRegisterData: RegisterRequestPayload | null;
  sendingOtp: boolean;
  registering: boolean;
  verifyingOtp: boolean;
  statusMessage: string | null;
  error: string | null;
  lastOtpMobile: string | null;
  lastOtpSentAt: number;
  lastFailedVerifyKey: string | null;
  crops: CropOptionItem[];
  cropsLoading: boolean;
  cropsLoaded: boolean;
  cropsError: string | null;
  profileLoading: boolean;
  profileLoaded: boolean;
  profileUpdating: boolean;
  profileError: string | null;
  lastProfileUserId: string | null;
}

const OTP_RESEND_COOLDOWN_MS = 25_000;

const initialToken = getStoredJwt();
const initialUser = initialToken ? getStoredUser() : null;

if (initialToken && !initialUser) {
  clearAuthStorage();
}

const initialState: AuthState = {
  user: initialUser,
  token: initialUser ? initialToken : null,
  isAuthenticated: Boolean(initialToken && initialUser),
  isAuthModalOpen: false,
  authStep: 'mobile',
  otpOrigin: 'login',
  pendingPhone: '',
  pendingCountryIso: DEFAULT_COUNTRY_ISO,
  pendingRegisterData: null,
  sendingOtp: false,
  registering: false,
  verifyingOtp: false,
  statusMessage: null,
  error: null,
  lastOtpMobile: null,
  lastOtpSentAt: 0,
  lastFailedVerifyKey: null,
  crops: [],
  cropsLoading: false,
  cropsLoaded: false,
  cropsError: null,
  profileLoading: false,
  profileLoaded: false,
  profileUpdating: false,
  profileError: null,
  lastProfileUserId: null,
};

function formatNetworkError(err: unknown, fallback: string): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Request cancelled.';
  }
  if (err instanceof TypeError) {
    return `Unable to reach auth server (${AUTH_API_BASE_URL}). Verify the API server is running and CORS is enabled.`;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

type SendOtpResult =
  | {
      outcome: 'otp_sent';
      mobile: string;
      countryIso: string;
      message: string;
      reusedRecentOtp: boolean;
    }
  | {
      outcome: 'needs_registration';
      mobile: string;
      countryIso: string;
      message: string;
    };

/**
 * Checks whether mobile number (with country code, e.g. +919553737309) is registered via POST /api/auth/send-otp.
 * - Registered & active user -> receives OTP and advances directly to OTP step.
 * - Unregistered (404) or unverified (403) user -> routes cleanly to registration step.
 */
export const sendOtp = createAsyncThunk<
  SendOtpResult,
  { mobile: string; countryIso?: string; force?: boolean },
  { state: { auth: AuthState }; rejectValue: string }
>(
  'auth/sendOtp',
  async ({ mobile, countryIso, force }, { getState, rejectWithValue, signal }) => {
    const iso =
      countryIso ||
      (mobile.trim().startsWith('+')
        ? findCountryByDialCode(mobile, getState().auth.pendingCountryIso).iso
        : getState().auth.pendingCountryIso || DEFAULT_COUNTRY_ISO);
    const fullPhone = normalizeFullPhone(mobile, iso);
    const { lastOtpMobile, lastOtpSentAt } = getState().auth;

    // Prevent redundant SMS API calls if an OTP was just dispatched for the same E.164 number
    if (
      !force &&
      lastOtpMobile === fullPhone &&
      Date.now() - lastOtpSentAt < OTP_RESEND_COOLDOWN_MS
    ) {
      return {
        outcome: 'otp_sent',
        mobile: fullPhone,
        countryIso: iso,
        message: 'A verification code was recently sent to this number. Enter it below.',
        reusedRecentOtp: true,
      };
    }

    try {
      const response = await fetch(`${AUTH_API_BASE_URL}${AUTH_ENDPOINTS.SEND_OTP}`, {
        method: 'POST',
        headers: AUTH_REQUEST_HEADERS,
        body: JSON.stringify({ mobile: fullPhone }),
        signal,
      });

      const data = await response.json().catch(() => ({}));
      const serverMsg = typeof data?.message === 'string' ? data.message : '';
      const statusCode = data?.statusCode ?? response.status;
      const responseMobile =
        typeof data?.data?.mobile === 'string'
          ? normalizeFullPhone(data.data.mobile, iso)
          : fullPhone;

      // Unregistered user (404) or incomplete/unverified registration (403) -> Register step
      if (
        statusCode === 404 ||
        statusCode === 403 ||
        /not registered|register first|not verified|complete registration/i.test(serverMsg)
      ) {
        return {
          outcome: 'needs_registration',
          mobile: responseMobile,
          countryIso: iso,
          message:
            serverMsg ||
            'Mobile number is not registered yet. Please complete registration below.',
        };
      }

      if (!response.ok || data?.success === false) {
        return rejectWithValue(serverMsg || 'Failed to send OTP. Please verify your number.');
      }

      return {
        outcome: 'otp_sent',
        mobile: responseMobile,
        countryIso: iso,
        message: serverMsg || 'Verification OTP sent to your mobile number.',
        reusedRecentOtp: false,
      };
    } catch (err) {
      return rejectWithValue(formatNetworkError(err, 'Unable to send OTP.'));
    }
  },
  {
    condition: ({ mobile, countryIso, force }, { getState }) => {
      const { auth } = getState();
      if (auth.sendingOtp || auth.registering || auth.verifyingOtp) return false;
      const iso =
        countryIso ||
        (mobile.trim().startsWith('+')
          ? findCountryByDialCode(mobile, auth.pendingCountryIso).iso
          : auth.pendingCountryIso || DEFAULT_COUNTRY_ISO);
      const fullPhone = normalizeFullPhone(mobile, iso);
      if (!isValidE164Mobile(fullPhone)) return false;
      if (
        !force &&
        auth.authStep === 'otp' &&
        auth.lastOtpMobile === fullPhone &&
        Date.now() - auth.lastOtpSentAt < OTP_RESEND_COOLDOWN_MS
      ) {
        return false;
      }
      return true;
    },
  }
);

type RegisterResult =
  | {
      outcome: 'otp_required';
      mobile: string;
      countryIso: string;
      registerData: RegisterRequestPayload;
      message: string;
    }
  | {
      outcome: 'already_registered';
      mobile: string;
      countryIso: string;
      message: string;
    }
  | {
      outcome: 'authenticated';
      token: string;
      user: UserProfile;
    };

/**
 * Fetches active crops from GET /api/crop/cropList once and caches them in Redux.
 */
export const fetchCropList = createAsyncThunk<
  CropOptionItem[],
  { force?: boolean } | void,
  { state: { auth: AuthState }; rejectValue: string }
>(
  'auth/fetchCropList',
  async (_arg, { rejectWithValue, signal }) => {
    try {
      const response = await fetch(`${AUTH_API_BASE_URL}${AUTH_ENDPOINTS.CROP_LIST}`, {
        method: 'GET',
        headers: { accept: '*/*' },
        signal,
      });

      const data = await response.json().catch(() => ({}));
      const serverMsg = typeof data?.message === 'string' ? data.message : '';

      if (!response.ok || data?.success === false) {
        return rejectWithValue(serverMsg || 'Failed to load crop list.');
      }

      const rawList = Array.isArray(data?.data) ? data.data : [];
      const normalized: CropOptionItem[] = rawList
        .filter(
          (item: any) =>
            item &&
            typeof item.id !== 'undefined' &&
            typeof item.name === 'string' &&
            item.name.trim().length > 0 &&
            (item.crop_status === undefined || Number(item.crop_status) === 1)
        )
        .map((item: any) => ({
          id: Number(item.id),
          label: String(item.name).trim(),
        }));

      if (normalized.length === 0) {
        return rejectWithValue('No crops returned from server.');
      }

      return normalized;
    } catch (err) {
      return rejectWithValue(formatNetworkError(err, 'Unable to load crop list.'));
    }
  },
  {
    condition: (arg, { getState }) => {
      const { auth } = getState();
      if (auth.cropsLoading || auth.cropsLoaded) return false;
      if (auth.cropsError && !(arg && arg.force)) return false;
      return true;
    },
  }
);

/**
 * Registers a new farmer via POST /api/auth/register and transitions to OTP verification.
 */
export const registerUser = createAsyncThunk<
  RegisterResult,
  RegisterRequestPayload,
  { state: { auth: AuthState }; rejectValue: string }
>(
  'auth/registerUser',
  async (payload, { getState, rejectWithValue, signal }) => {
    const countryIsoFromName = findCountryByName(payload.country)?.iso;
    const fallbackIso = countryIsoFromName || getState().auth.pendingCountryIso || DEFAULT_COUNTRY_ISO;
    const fullPhone = normalizeFullPhone(payload.mobile, fallbackIso);
    const phoneCountry = findCountryByDialCode(fullPhone, fallbackIso);
    const phoneCountryIso = phoneCountry.iso;
    const resolvedCountry = payload.country?.trim() || phoneCountry.name || 'India';
    const trimmedEmail = payload.email?.trim();
    const hasCoords =
      typeof payload.latitude === 'number' &&
      Number.isFinite(payload.latitude) &&
      typeof payload.longitude === 'number' &&
      Number.isFinite(payload.longitude);

    const apiBody = {
      mobile: fullPhone,
      ...(trimmedEmail ? { email: trimmedEmail } : {}),
      full_name: payload.full_name.trim(),
      crop_id: Number(payload.crop_id) || 1,
      country: resolvedCountry,
      district: payload.district.trim(),
      state: payload.state.trim(),
      pincode: payload.pincode.trim(),
      village: payload.village.trim(),
    };

    const requestPayload: RegisterRequestPayload = {
      ...apiBody,
      ...(hasCoords ? { latitude: payload.latitude, longitude: payload.longitude } : {}),
    };

    try {
      const response = await fetch(`${AUTH_API_BASE_URL}${AUTH_ENDPOINTS.REGISTER}`, {
        method: 'POST',
        headers: AUTH_REQUEST_HEADERS,
        body: JSON.stringify(apiBody),
        signal,
      });

      const data = await response.json().catch(() => ({}));
      const serverMsg = typeof data?.message === 'string' ? data.message : '';

      if (!response.ok || data?.success === false) {
        if (response.status === 409 || /already registered|already exists/i.test(serverMsg)) {
          return {
            outcome: 'already_registered',
            mobile: fullPhone,
            countryIso: phoneCountryIso,
            message:
              serverMsg || 'Mobile number is already registered. Sign in with OTP instead.',
          };
        }
        return rejectWithValue(serverMsg || 'Registration failed. Please verify your details.');
      }

      const headerToken = response.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
      const token = extractJwtToken(data) || headerToken;

      if (token) {
        const user = mapApiUserToProfile(
          data,
          fullPhone,
          requestPayload,
          decodeJwtPayload(token)
        );
        saveAuthStorage(token, user);
        return { outcome: 'authenticated', token, user };
      }

      if (data?.alreadyRegistered && !data?.pendingVerification) {
        return {
          outcome: 'already_registered',
          mobile: fullPhone,
          countryIso: phoneCountryIso,
          message:
            serverMsg || 'This mobile number is already registered. Tap Send OTP to sign in.',
        };
      }

      return {
        outcome: 'otp_required',
        mobile: fullPhone,
        countryIso: phoneCountryIso,
        registerData: requestPayload,
        message: serverMsg || 'Registration initiated. Enter the OTP sent to your mobile.',
      };
    } catch (err) {
      return rejectWithValue(formatNetworkError(err, 'Unable to complete registration.'));
    }
  },
  {
    condition: (payload, { getState }) => {
      const { auth } = getState();
      if (auth.registering || auth.sendingOtp || auth.verifyingOtp) return false;
      const fallbackIso = findCountryByName(payload.country)?.iso || auth.pendingCountryIso;
      const fullPhone = normalizeFullPhone(payload.mobile, fallbackIso);
      return isValidE164Mobile(fullPhone);
    },
  }
);

/**
 * Verifies the 6-digit OTP via POST /api/auth/verify-otp with E.164 mobile (+countryCode), extracts JWT, and stores session.
 */
export const verifyOtp = createAsyncThunk<
  { token: string; user: UserProfile },
  { mobile: string; otp: string },
  { state: { auth: AuthState }; rejectValue: { message: string; verifyKey: string } }
>(
  'auth/verifyOtp',
  async ({ mobile, otp }, { getState, rejectWithValue, signal }) => {
    const fullPhone = normalizeFullPhone(mobile, getState().auth.pendingCountryIso);
    const cleanOtp = otp.replace(/\D/g, '').slice(0, 6);
    const verifyKey = `${fullPhone}:${cleanOtp}`;

    try {
      const response = await fetch(`${AUTH_API_BASE_URL}${AUTH_ENDPOINTS.VERIFY_OTP}`, {
        method: 'POST',
        headers: AUTH_REQUEST_HEADERS,
        body: JSON.stringify({
          mobile: fullPhone,
          otp: cleanOtp,
        }),
        signal,
      });

      const data = await response.json().catch(() => ({}));
      const serverMsg = typeof data?.message === 'string' ? data.message : '';

      if (!response.ok || data?.success === false) {
        return rejectWithValue({
          message: serverMsg || 'Invalid or expired OTP. Please try again.',
          verifyKey,
        });
      }

      const headerToken = response.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
      const token = extractJwtToken(data) || headerToken;

      if (!token) {
        return rejectWithValue({
          message: 'Verification succeeded, but no JWT token was returned by the server.',
          verifyKey,
        });
      }

      const { pendingRegisterData } = getState().auth;
      const user = mapApiUserToProfile(
        data,
        fullPhone,
        pendingRegisterData,
        decodeJwtPayload(token)
      );

      saveAuthStorage(token, user);
      return { token, user };
    } catch (err) {
      return rejectWithValue({
        message: formatNetworkError(err, 'OTP verification failed.'),
        verifyKey,
      });
    }
  },
  {
    condition: ({ mobile, otp }, { getState }) => {
      const { auth } = getState();
      if (auth.verifyingOtp || auth.sendingOtp || auth.registering) return false;
      const fullPhone = normalizeFullPhone(mobile, auth.pendingCountryIso);
      const cleanOtp = otp.replace(/\D/g, '');
      if (!isValidE164Mobile(fullPhone) || cleanOtp.length !== 6) return false;
      // Avoid duplicate network calls when user retries exact unchanged invalid OTP
      if (auth.lastFailedVerifyKey === `${fullPhone}:${cleanOtp}`) return false;
      return true;
    },
  }
);

/**
 * Fetches the authenticated farmer profile via GET /api/auth/profile/{user_id}.
 */
export const fetchUserProfile = createAsyncThunk<
  { user: UserProfile; userId: string },
  { userId?: string; force?: boolean } | void,
  { state: { auth: AuthState }; rejectValue: string }
>(
  'auth/fetchUserProfile',
  async (arg, { getState, rejectWithValue, signal }) => {
    const { auth } = getState();
    const decoded = auth.token ? decodeJwtPayload(auth.token) : null;
    const userId = arg?.userId || resolveNumericUserId(auth.user, decoded);
    if (!userId) {
      return rejectWithValue('Unable to determine user ID for profile lookup.');
    }

    try {
      const response = await fetch(`${AUTH_API_BASE_URL}${AUTH_ENDPOINTS.GET_PROFILE(userId)}`, {
        method: 'GET',
        headers: {
          accept: '*/*',
          ...getAuthHeaders(),
        },
        signal,
      });

      const data = await response.json().catch(() => ({}));
      const serverMsg = typeof data?.message === 'string' ? data.message : '';

      if (!response.ok || data?.success === false) {
        return rejectWithValue(serverMsg || 'Failed to fetch user profile.');
      }

      const mapped = mapApiUserToProfile(data, auth.user?.phone || '', null, decoded);
      const current = auth.user;

      const merged: UserProfile = {
        ...(current || {}),
        ...mapped,
        // Preserve local workspace extensions not returned by GET /api/auth/profile/{user_id}
        holding: data?.data?.holding || current?.holding || mapped.holding,
        station: data?.data?.station || current?.station || mapped.station,
        kisanId: data?.data?.kisanId || current?.kisanId || mapped.kisanId,
        pmfbyPolicy: data?.data?.pmfbyPolicy || current?.pmfbyPolicy || mapped.pmfbyPolicy,
        insuredSum: data?.data?.insuredSum || current?.insuredSum || mapped.insuredSum,
        linkedBankMask:
          data?.data?.linkedBankMask || current?.linkedBankMask || mapped.linkedBankMask,
        registeredParcelsCount:
          typeof data?.data?.registeredParcelsCount === 'number'
            ? data.data.registeredParcelsCount
            : current?.registeredParcelsCount ?? mapped.registeredParcelsCount,
        landscape: data?.data?.landscape || current?.landscape || mapped.landscape,
        // Respect explicit server photo_url when present; keep existing avatar if server photo_url is null and local had custom data
        avatar: mapped.avatar || current?.avatar || '',
      };

      if (auth.token) {
        saveAuthStorage(auth.token, merged);
      }

      return { user: merged, userId };
    } catch (err) {
      return rejectWithValue(formatNetworkError(err, 'Unable to load user profile.'));
    }
  },
  {
    condition: (arg, { getState }) => {
      const { auth } = getState();
      if (!auth.isAuthenticated) return false;
      if (auth.profileLoading) return false;
      const decoded = auth.token ? decodeJwtPayload(auth.token) : null;
      const userId = arg?.userId || resolveNumericUserId(auth.user, decoded);
      if (!userId) return false;
      if (auth.profileLoaded && auth.lastProfileUserId === userId && !(arg && arg.force)) {
        return false;
      }
      return true;
    },
  }
);

/**
 * Updates the farmer profile via PUT /api/auth/updateProfile/{user_id} and syncs local session state.
 */
export const saveUserProfile = createAsyncThunk<
  { user: UserProfile; message: string },
  {
    userId?: string;
    apiPayload: UpdateProfileRequestPayload;
    localOverrides?: Partial<UserProfile>;
  },
  { state: { auth: AuthState }; rejectValue: string }
>(
  'auth/saveUserProfile',
  async ({ userId: explicitId, apiPayload, localOverrides }, { getState, rejectWithValue, signal }) => {
    const { auth } = getState();
    const decoded = auth.token ? decodeJwtPayload(auth.token) : null;
    const userId = explicitId || resolveNumericUserId(auth.user, decoded);

    if (!userId) {
      return rejectWithValue('Unable to determine user ID for profile update.');
    }

    try {
      const response = await fetch(
        `${AUTH_API_BASE_URL}${AUTH_ENDPOINTS.UPDATE_PROFILE(userId)}`,
        {
          method: 'PUT',
          headers: {
            ...AUTH_REQUEST_HEADERS,
            ...getAuthHeaders(),
          },
          body: JSON.stringify(apiPayload),
          signal,
        }
      );

      const data = await response.json().catch(() => ({}));
      const serverMsg = typeof data?.message === 'string' ? data.message : '';

      if (!response.ok || data?.success === false) {
        return rejectWithValue(serverMsg || 'Failed to update profile.');
      }

      const serverProfile =
        data?.data && typeof data.data === 'object'
          ? mapApiUserToProfile(data, apiPayload.mobile, null, decoded)
          : null;

      const baseUser = auth.user;
      const countryOpt =
        findCountryByName(apiPayload.country) || findCountryByDialCode(apiPayload.mobile);
      const formattedMobile = formatPhoneForDisplay(apiPayload.mobile, countryOpt.iso);
      const nextVillage = apiPayload.village?.trim() || serverProfile?.village || baseUser?.village;
      const nextDistrict = serverProfile?.district || apiPayload.district.trim();
      const nextState = serverProfile?.state || apiPayload.state.trim();
      const nextCountry = serverProfile?.country || apiPayload.country.trim() || 'India';
      const locationParts = [nextVillage, nextDistrict, nextState].filter(Boolean);

      const merged: UserProfile = {
        ...(baseUser || {}),
        ...(serverProfile || {}),
        ...(localOverrides || {}),
        id: serverProfile?.id || baseUser?.id || `farmer-${userId}`,
        rawId: serverProfile?.rawId || baseUser?.rawId || String(userId),
        name: serverProfile?.name || apiPayload.full_name.trim(),
        phone: formattedMobile || serverProfile?.phone || baseUser?.phone || apiPayload.mobile,
        email: serverProfile?.email || apiPayload.email || undefined,
        role: localOverrides?.role || serverProfile?.role || baseUser?.role || 'Farmer account',
        farmerPartner:
          localOverrides?.farmerPartner ||
          serverProfile?.farmerPartner ||
          baseUser?.farmerPartner ||
          'Farmer Partner',
        holding: localOverrides?.holding || serverProfile?.holding || baseUser?.holding || '1.0 Acre',
        station:
          localOverrides?.station ||
          serverProfile?.station ||
          baseUser?.station ||
          `Ag-Weather Station • ${nextVillage || nextDistrict || nextCountry}`,
        kisanId:
          localOverrides?.kisanId ||
          serverProfile?.kisanId ||
          baseUser?.kisanId ||
          `KD-${String(userId).padStart(6, '0')}`,
        pmfbyPolicy:
          localOverrides?.pmfbyPolicy ||
          serverProfile?.pmfbyPolicy ||
          baseUser?.pmfbyPolicy ||
          '',
        insuredSum:
          localOverrides?.insuredSum ||
          serverProfile?.insuredSum ||
          baseUser?.insuredSum ||
          '',
        linkedBankMask:
          localOverrides?.linkedBankMask ||
          serverProfile?.linkedBankMask ||
          baseUser?.linkedBankMask ||
          '',
        landscape: serverProfile?.landscape || baseUser?.landscape || '',
        registeredParcelsCount:
          localOverrides?.registeredParcelsCount ??
          serverProfile?.registeredParcelsCount ??
          baseUser?.registeredParcelsCount ??
          1,
        avatar: serverProfile?.avatar || apiPayload.photo_url || '',
        cropId: serverProfile?.cropId ?? apiPayload.crop_id,
        country: nextCountry,
        state: nextState || undefined,
        district: nextDistrict || undefined,
        village: nextVillage || undefined,
        pincode: serverProfile?.pincode || apiPayload.pincode.trim() || undefined,
        latitude:
          serverProfile?.latitude ??
          (typeof apiPayload.latitude === 'number' && Number.isFinite(apiPayload.latitude)
            ? apiPayload.latitude
            : undefined),
        longitude:
          serverProfile?.longitude ??
          (typeof apiPayload.longitude === 'number' && Number.isFinite(apiPayload.longitude)
            ? apiPayload.longitude
            : undefined),
        location:
          locationParts.length > 0
            ? locationParts.join(', ')
            : nextCountry || baseUser?.location || '',
      };

      if (auth.token) {
        saveAuthStorage(auth.token, merged);
      }

      return {
        user: merged,
        message: serverMsg || 'Profile updated successfully.',
      };
    } catch (err) {
      return rejectWithValue(formatNetworkError(err, 'Unable to update profile.'));
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    openAuthModal(state) {
      state.isAuthModalOpen = true;
      state.error = null;
    },
    closeAuthModal(state) {
      state.isAuthModalOpen = false;
      state.error = null;
      state.statusMessage = null;
      state.authStep = 'mobile';
      state.sendingOtp = false;
      state.registering = false;
      state.verifyingOtp = false;
      state.lastFailedVerifyKey = null;
    },
    setAuthStep(
      state,
      action: PayloadAction<{ step: AuthStep; mobile?: string; countryIso?: string }>
    ) {
      state.authStep = action.payload.step;
      if (action.payload.countryIso) {
        state.pendingCountryIso = action.payload.countryIso;
      }
      if (typeof action.payload.mobile === 'string') {
        state.pendingPhone = action.payload.mobile
          ? normalizeFullPhone(action.payload.mobile, state.pendingCountryIso)
          : '';
      }
      state.error = null;
      state.statusMessage = null;
      state.lastFailedVerifyKey = null;
    },
    clearAuthMessages(state) {
      if (state.error) state.error = null;
      if (state.lastFailedVerifyKey) state.lastFailedVerifyKey = null;
    },
    logout(state) {
      clearAuthStorage();
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.authStep = 'mobile';
      state.otpOrigin = 'login';
      state.pendingPhone = '';
      state.pendingCountryIso = DEFAULT_COUNTRY_ISO;
      state.pendingRegisterData = null;
      state.statusMessage = null;
      state.error = null;
      state.lastOtpMobile = null;
      state.lastOtpSentAt = 0;
      state.lastFailedVerifyKey = null;
      state.profileLoading = false;
      state.profileLoaded = false;
      state.profileUpdating = false;
      state.profileError = null;
      state.lastProfileUserId = null;
    },
    updateUserProfile(state, action: PayloadAction<Partial<UserProfile>>) {
      if (!state.user) return;
      const merged: UserProfile = {
        ...state.user,
        ...action.payload,
      };
      const locationParts = [merged.village, merged.district, merged.state].filter(Boolean);
      if (locationParts.length > 0) {
        merged.location = locationParts.join(', ');
      } else if (merged.country) {
        merged.location = merged.country;
      }
      state.user = merged;
      if (state.token) {
        saveAuthStorage(state.token, merged);
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // sendOtp
      .addCase(sendOtp.pending, (state) => {
        state.sendingOtp = true;
        state.error = null;
        state.statusMessage = null;
      })
      .addCase(sendOtp.fulfilled, (state, action) => {
        state.sendingOtp = false;
        state.pendingPhone = action.payload.mobile;
        state.pendingCountryIso = action.payload.countryIso;
        state.error = null;

        if (action.payload.outcome === 'needs_registration') {
          state.authStep = 'register';
          state.statusMessage = action.payload.message;
          if (
            state.pendingRegisterData &&
            normalizeFullPhone(state.pendingRegisterData.mobile, action.payload.countryIso) !==
              action.payload.mobile
          ) {
            state.pendingRegisterData = null;
          }
        } else {
          state.authStep = 'otp';
          if (!action.payload.reusedRecentOtp) {
            state.otpOrigin = 'login';
            state.lastOtpMobile = action.payload.mobile;
            state.lastOtpSentAt = Date.now();
          } else {
            const hasPendingForNumber =
              state.pendingRegisterData &&
              normalizeFullPhone(state.pendingRegisterData.mobile, action.payload.countryIso) ===
                action.payload.mobile;
            if (!hasPendingForNumber) {
              state.otpOrigin = 'login';
            }
          }
          state.statusMessage = action.payload.message;
          state.lastFailedVerifyKey = null;
        }
      })
      .addCase(sendOtp.rejected, (state, action) => {
        state.sendingOtp = false;
        if (!action.meta.condition) {
          state.error = action.payload || 'Failed to send OTP.';
        }
      })
      // registerUser
      .addCase(registerUser.pending, (state) => {
        state.registering = true;
        state.error = null;
        state.statusMessage = null;
      })
      .addCase(registerUser.fulfilled, (state, action) => {
        state.registering = false;
        state.error = null;

        if (action.payload.outcome === 'authenticated') {
          state.token = action.payload.token;
          state.user = action.payload.user;
          state.isAuthenticated = true;
          state.isAuthModalOpen = false;
          state.authStep = 'mobile';
          state.pendingPhone = '';
          state.pendingCountryIso = DEFAULT_COUNTRY_ISO;
          state.pendingRegisterData = null;
          state.statusMessage = null;
          state.profileLoaded = false;
          state.profileError = null;
        } else if (action.payload.outcome === 'already_registered') {
          state.pendingPhone = action.payload.mobile;
          state.pendingCountryIso = action.payload.countryIso;
          state.authStep = 'mobile';
          state.statusMessage = action.payload.message;
        } else {
          state.pendingPhone = action.payload.mobile;
          state.pendingCountryIso = action.payload.countryIso;
          state.pendingRegisterData = action.payload.registerData;
          state.otpOrigin = 'register';
          state.authStep = 'otp';
          state.statusMessage = action.payload.message;
          state.lastOtpMobile = action.payload.mobile;
          state.lastOtpSentAt = Date.now();
          state.lastFailedVerifyKey = null;
        }
      })
      .addCase(registerUser.rejected, (state, action) => {
        state.registering = false;
        if (!action.meta.condition) {
          state.error = action.payload || 'Registration failed.';
        }
      })
      // verifyOtp
      .addCase(verifyOtp.pending, (state) => {
        state.verifyingOtp = true;
        state.error = null;
      })
      .addCase(verifyOtp.fulfilled, (state, action) => {
        state.verifyingOtp = false;
        state.token = action.payload.token;
        state.user = action.payload.user;
        state.isAuthenticated = true;
        state.isAuthModalOpen = false;
        state.authStep = 'mobile';
        state.otpOrigin = 'login';
        state.pendingPhone = '';
        state.pendingCountryIso = DEFAULT_COUNTRY_ISO;
        state.pendingRegisterData = null;
        state.statusMessage = null;
        state.error = null;
        state.lastOtpMobile = null;
        state.lastOtpSentAt = 0;
        state.lastFailedVerifyKey = null;
        state.profileLoaded = false;
        state.profileError = null;
      })
      .addCase(verifyOtp.rejected, (state, action) => {
        state.verifyingOtp = false;
        if (action.payload) {
          state.error = action.payload.message;
          state.lastFailedVerifyKey = action.payload.verifyKey;
        } else if (!action.meta.condition) {
          state.error = 'OTP verification failed.';
        }
      })
      // fetchCropList
      .addCase(fetchCropList.pending, (state) => {
        state.cropsLoading = true;
        state.cropsError = null;
      })
      .addCase(fetchCropList.fulfilled, (state, action) => {
        state.cropsLoading = false;
        state.cropsLoaded = true;
        state.crops = action.payload;
        state.cropsError = null;
      })
      .addCase(fetchCropList.rejected, (state, action) => {
        state.cropsLoading = false;
        if (!action.meta.condition) {
          state.cropsError = action.payload || 'Failed to load crops.';
        }
      })
      // fetchUserProfile
      .addCase(fetchUserProfile.pending, (state) => {
        state.profileLoading = true;
        state.profileError = null;
      })
      .addCase(fetchUserProfile.fulfilled, (state, action) => {
        state.profileLoading = false;
        state.profileLoaded = true;
        state.profileError = null;
        state.lastProfileUserId = action.payload.userId;
        state.user = action.payload.user;
      })
      .addCase(fetchUserProfile.rejected, (state, action) => {
        state.profileLoading = false;
        if (!action.meta.condition) {
          state.profileError = action.payload || 'Failed to fetch user profile.';
        }
      })
      // saveUserProfile
      .addCase(saveUserProfile.pending, (state) => {
        state.profileUpdating = true;
        state.profileError = null;
      })
      .addCase(saveUserProfile.fulfilled, (state, action) => {
        state.profileUpdating = false;
        state.profileLoaded = true;
        state.profileError = null;
        state.user = action.payload.user;
        state.lastProfileUserId = action.payload.user.rawId || state.lastProfileUserId;
      })
      .addCase(saveUserProfile.rejected, (state, action) => {
        state.profileUpdating = false;
        if (!action.meta.condition) {
          state.profileError = action.payload || 'Failed to update profile.';
        }
      });
  },
});

export const {
  openAuthModal,
  closeAuthModal,
  setAuthStep,
  clearAuthMessages,
  logout,
  updateUserProfile,
} = authSlice.actions;

// Granular primitive & memoized selectors prevent unrelated UI re-renders
export const selectIsAuthenticated = (state: { auth: AuthState }) => state.auth.isAuthenticated;
export const selectAuthUser = (state: { auth: AuthState }) => state.auth.user;
export const selectAuthToken = (state: { auth: AuthState }) => state.auth.token;

export const selectCropOptionsUi = createSelector(
  [
    (state: { auth: AuthState }) => state.auth.crops,
    (state: { auth: AuthState }) => state.auth.cropsLoading,
    (state: { auth: AuthState }) => state.auth.cropsLoaded,
    (state: { auth: AuthState }) => state.auth.cropsError,
  ],
  (crops, cropsLoading, cropsLoaded, cropsError) => ({
    crops,
    cropsLoading,
    cropsLoaded,
    cropsError,
  })
);

export const selectProfileUi = createSelector(
  [
    (state: { auth: AuthState }) => state.auth.profileLoading,
    (state: { auth: AuthState }) => state.auth.profileLoaded,
    (state: { auth: AuthState }) => state.auth.profileUpdating,
    (state: { auth: AuthState }) => state.auth.profileError,
  ],
  (profileLoading, profileLoaded, profileUpdating, profileError) => ({
    profileLoading,
    profileLoaded,
    profileUpdating,
    profileError,
  })
);

export const selectAuthModalUi = createSelector(
  [
    (state: { auth: AuthState }) => state.auth.isAuthModalOpen,
    (state: { auth: AuthState }) => state.auth.authStep,
    (state: { auth: AuthState }) => state.auth.otpOrigin,
    (state: { auth: AuthState }) => state.auth.pendingPhone,
    (state: { auth: AuthState }) => state.auth.pendingCountryIso,
    (state: { auth: AuthState }) => state.auth.pendingRegisterData,
    (state: { auth: AuthState }) => state.auth.sendingOtp,
    (state: { auth: AuthState }) => state.auth.registering,
    (state: { auth: AuthState }) => state.auth.verifyingOtp,
    (state: { auth: AuthState }) => state.auth.statusMessage,
    (state: { auth: AuthState }) => state.auth.error,
  ],
  (
    isAuthModalOpen,
    authStep,
    otpOrigin,
    pendingPhone,
    pendingCountryIso,
    pendingRegisterData,
    sendingOtp,
    registering,
    verifyingOtp,
    statusMessage,
    error
  ) => ({
    isAuthModalOpen,
    authStep,
    otpOrigin,
    pendingPhone,
    pendingCountryIso,
    pendingRegisterData,
    sendingOtp,
    registering,
    verifyingOtp,
    statusMessage,
    error,
  })
);

export default authSlice.reducer;
