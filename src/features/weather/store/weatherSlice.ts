/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAsyncThunk, createSelector, createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  CurrentWeatherData,
  DailyForecastItem,
  HourlyForecastItem,
  ImdCurrentObservation,
  ImdDistrictRainfall,
  ImdDistrictWarning,
  ImdForecastObservation,
  ImdWeatherErrors,
  WeatherAdvisoryResponse,
  WeatherLocation,
  WeatherMeta,
} from '../../../shared/types';
import {
  CROP_STAGE_OPTIONS,
  DEFAULT_WEATHER_LOCATION,
  fetchCurrentWeatherApi,
  fetchForecastWeatherApi,
  fetchHourlyWeatherApi,
  fetchWeatherAdvisoryApi,
  formatLocationLabel,
  geocodeAddressText,
  getStoredWeatherLocation,
  saveWeatherLocationStorage,
} from '../services/weatherApi';
import {
  fetchImdCurrentApi,
  fetchImdForecastApi,
  fetchImdRainfallApi,
  fetchImdWarningsApi,
  normalizeImdCurrentToWeatherData,
  normalizeImdForecastToDailyItems,
  pickBestImdCurrentStation,
} from '../services/imdWeatherApi';
import { getStoredJwt, getStoredUser } from '../../auth/utils/jwt';
import { fetchUserProfile, logout, registerUser, verifyOtp } from '../../auth/store/authSlice';

const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000;
const IMD_CACHE_TTL_MS = 10 * 60 * 1000;

export interface WeatherState {
  location: WeatherLocation;
  isLocationModalOpen: boolean;
  meta: WeatherMeta | null;
  current: CurrentWeatherData | null;
  forecast: DailyForecastItem[];
  hourly: HourlyForecastItem[];
  loading: boolean;
  error: string | null;
  lastFetchedKey: string | null;
  inFlightKey: string | null;
  lastFetchedAt: number;
  lastGeocodedAddressKey: string | null;
  pendingAddressQuery: string | null;
  advisory: WeatherAdvisoryResponse | null;
  advisoryLoading: boolean;
  advisoryError: string | null;
  advisoryCropStage: string;
  lastAdvisoryKey: string | null;
  inFlightAdvisoryKey: string | null;
  lastAdvisoryFetchedAt: number;
  imdCurrentStations: ImdCurrentObservation[];
  imdCurrent: ImdCurrentObservation | null;
  imdCurrentStationId: string | null;
  imdForecast: ImdForecastObservation | null;
  imdForecastStationId: string | null;
  imdWarnings: ImdDistrictWarning | null;
  imdDistrictId: string | null;
  imdRainfall: ImdDistrictRainfall | null;
  imdLoading: boolean;
  imdError: string | null;
  imdSectionErrors: ImdWeatherErrors;
  imdLastFetchedKey: string | null;
  imdInFlightKey: string | null;
  imdLastFetchedAt: number;
  weatherSource: {
    current: 'IMD' | 'FALLBACK' | null;
    forecast: 'IMD' | 'FALLBACK' | null;
  };
}

function normalizeOptionalUserId(userId?: string): string | undefined {
  const cleaned = (userId || '').replace(/^farmer-/, '').trim();
  return cleaned || undefined;
}

function normalizeAdvisoryUserId(userId?: string): number {
  const cleaned = normalizeOptionalUserId(userId);
  if (!cleaned) return 1;
  const parsed = Number(cleaned);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function buildWeatherFetchKey(
  userId: string | undefined,
  latitude: number,
  longitude: number,
  stationId?: string
): string {
  const st = (stationId || '').trim();
  return `${normalizeOptionalUserId(userId) || 'guest'}|${latitude.toFixed(4)}|${longitude.toFixed(4)}|${st}`;
}

export function buildAdvisoryFetchKey(params: {
  userId?: string;
  latitude: number;
  longitude: number;
  cropStage?: string;
  language?: string;
  forecastDays?: number;
}): string {
  const uid = normalizeAdvisoryUserId(params.userId);
  const stage = (params.cropStage || 'Vegetative').trim().toLowerCase();
  const lang = (params.language || 'en').trim().toLowerCase();
  const days = Math.min(16, Math.max(1, Math.trunc(params.forecastDays || 7)));
  return `${uid}|${params.latitude.toFixed(4)}|${params.longitude.toFixed(4)}|${stage}|${lang}|${days}`;
}

function getInitialLocation(): WeatherLocation {
  const storedLoc = getStoredWeatherLocation();
  if (storedLoc && storedLoc.source !== 'default') return storedLoc;

  const storedUser = getStoredUser();
  if (storedUser) {
    const label = formatLocationLabel({
      village: storedUser.village,
      district: storedUser.district,
      state: storedUser.state,
      country: storedUser.country,
      latitude: storedUser.latitude,
      longitude: storedUser.longitude,
    });
    if (
      typeof storedUser.latitude === 'number' &&
      Number.isFinite(storedUser.latitude) &&
      typeof storedUser.longitude === 'number' &&
      Number.isFinite(storedUser.longitude)
    ) {
      return {
        latitude: storedUser.latitude,
        longitude: storedUser.longitude,
        label,
        country: storedUser.country,
        state: storedUser.state,
        district: storedUser.district,
        village: storedUser.village,
        pincode: storedUser.pincode,
        source: 'profile',
      };
    }
    if (storedUser.village || storedUser.district || storedUser.state) {
      return {
        ...(storedLoc || DEFAULT_WEATHER_LOCATION),
        label,
        country: storedUser.country,
        state: storedUser.state,
        district: storedUser.district,
        village: storedUser.village,
        pincode: storedUser.pincode,
        source: 'profile',
      };
    }
  }

  return storedLoc || DEFAULT_WEATHER_LOCATION;
}

const initialState: WeatherState = {
  location: getInitialLocation(),
  isLocationModalOpen: false,
  meta: null,
  current: null,
  forecast: [],
  hourly: [],
  loading: false,
  error: null,
  lastFetchedKey: null,
  inFlightKey: null,
  lastFetchedAt: 0,
  lastGeocodedAddressKey: null,
  pendingAddressQuery: null,
  advisory: null,
  advisoryLoading: false,
  advisoryError: null,
  advisoryCropStage: CROP_STAGE_OPTIONS[2],
  lastAdvisoryKey: null,
  inFlightAdvisoryKey: null,
  lastAdvisoryFetchedAt: 0,
  imdCurrentStations: [],
  imdCurrent: null,
  imdCurrentStationId: null,
  imdForecast: null,
  imdForecastStationId: null,
  imdWarnings: null,
  imdDistrictId: null,
  imdRainfall: null,
  imdLoading: false,
  imdError: null,
  imdSectionErrors: {},
  imdLastFetchedKey: null,
  imdInFlightKey: null,
  imdLastFetchedAt: 0,
  weatherSource: {
    current: null,
    forecast: null,
  },
};

interface FetchWeatherArgs {
  userId?: string;
  latitude: number;
  longitude: number;
  stationId?: string;
  force?: boolean;
}

interface FetchWeatherResult {
  key: string;
  current: CurrentWeatherData;
  forecast: DailyForecastItem[];
  hourly: HourlyForecastItem[];
  meta: WeatherMeta;
  weatherSource: {
    current: 'IMD' | 'FALLBACK';
    forecast: 'IMD' | 'FALLBACK';
  };
  imdCurrentStations: ImdCurrentObservation[];
  imdCurrent: ImdCurrentObservation | null;
  imdCurrentStationId: string | null;
  imdForecast: ImdForecastObservation | null;
  imdForecastStationId: string | null;
  imdStationErrors: Pick<ImdWeatherErrors, 'current' | 'forecast'>;
}

/**
 * Fetches weather telemetry using IMD station APIs first (when JWT + profile station_id exist),
 * then falls back independently per-endpoint to /api/weather/current and /api/weather/forecast
 * whenever IMD is unavailable or returns incomplete data.
 */
export const fetchWeatherBundle = createAsyncThunk<
  FetchWeatherResult,
  FetchWeatherArgs,
  { state: { weather: WeatherState }; rejectValue: string }
>(
  'weather/fetchBundle',
  async ({ userId, latitude, longitude, stationId }, { getState, rejectWithValue, signal }) => {
    const effectiveUserId = normalizeOptionalUserId(userId);
    const cleanStationId = (stationId || '').trim() || undefined;
    const hasJwt = Boolean(getStoredJwt());
    const key = buildWeatherFetchKey(effectiveUserId, latitude, longitude, cleanStationId);
    const loc = getState().weather.location;

    try {
      // Start hourly fetch alongside primary weather lookup (IMD has no hourly endpoint)
      const hourlyPromise = fetchHourlyWeatherApi(effectiveUserId, latitude, longitude, signal);

      let imdCurrentStations: ImdCurrentObservation[] = [];
      let imdCurrent: ImdCurrentObservation | null = null;
      let imdCurrentStationId: string | null = null;
      let imdForecast: ImdForecastObservation | null = null;
      let imdForecastStationId: string | null = null;
      const imdStationErrors: Pick<ImdWeatherErrors, 'current' | 'forecast'> = {};

      let normalizedImdCurrent: CurrentWeatherData | null = null;
      let normalizedImdForecast: DailyForecastItem[] = [];

      const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

      if (hasJwt && (cleanStationId || hasCoords)) {
        const [imdCurRes, imdFcRes] = await Promise.allSettled([
          fetchImdCurrentApi({ stationId: cleanStationId, latitude, longitude }, signal),
          fetchImdForecastApi({ stationId: cleanStationId, latitude, longitude }, signal),
        ]);

        if (signal.aborted) {
          return rejectWithValue('Weather request cancelled.');
        }

        if (imdFcRes.status === 'fulfilled') {
          imdForecast = imdFcRes.value.forecast;
          imdForecastStationId = imdFcRes.value.stationId;
        } else {
          imdStationErrors.forecast =
            imdFcRes.reason instanceof Error
              ? imdFcRes.reason.message
              : 'Unable to load IMD station forecast.';
        }

        if (imdCurRes.status === 'fulfilled') {
          imdCurrentStations = imdCurRes.value.stations;
          imdCurrent = pickBestImdCurrentStation(imdCurrentStations, {
            explicitStationId: cleanStationId || imdCurRes.value.stationId,
            forecastStationCode: imdForecast?.Station_Code || imdForecastStationId,
            forecastStationName: imdForecast?.Station_Name,
            village: loc.village,
            district: loc.district,
            state: loc.state,
            label: loc.label,
          });
          imdCurrentStationId =
            imdCurRes.value.stationId || imdCurrent?.['Station Id'] || cleanStationId || null;
          normalizedImdCurrent = normalizeImdCurrentToWeatherData(imdCurrent);
          if (!normalizedImdCurrent) {
            imdStationErrors.current =
              'IMD current station observation lacked temperature telemetry; using fallback.';
          }
        } else if (cleanStationId && hasCoords) {
          // If explicit station_id returned 404/empty on current observation, try IMD station directory by coordinates before normal fallback
          try {
            const coordCur = await fetchImdCurrentApi({ latitude, longitude }, signal);
            imdCurrentStations = coordCur.stations;
            imdCurrent = pickBestImdCurrentStation(imdCurrentStations, {
              explicitStationId: coordCur.stationId,
              forecastStationCode: imdForecast?.Station_Code || imdForecastStationId,
              forecastStationName: imdForecast?.Station_Name,
              village: loc.village,
              district: loc.district,
              state: loc.state,
              label: loc.label,
            });
            imdCurrentStationId =
              coordCur.stationId || imdCurrent?.['Station Id'] || cleanStationId || null;
            normalizedImdCurrent = normalizeImdCurrentToWeatherData(imdCurrent);
            if (!normalizedImdCurrent) {
              imdStationErrors.current =
                'IMD current station observation lacked temperature telemetry; using fallback.';
            }
          } catch (retryErr) {
            imdStationErrors.current =
              retryErr instanceof Error
                ? retryErr.message
                : 'Unable to load IMD current station.';
          }
        } else {
          imdStationErrors.current =
            imdCurRes.reason instanceof Error
              ? imdCurRes.reason.message
              : 'Unable to load IMD current station.';
        }

        normalizedImdForecast = normalizeImdForecastToDailyItems(
          imdForecast,
          normalizedImdCurrent?.wind_speed_10m ?? 10
        );
        if (imdFcRes.status === 'fulfilled' && normalizedImdForecast.length === 0) {
          imdStationErrors.forecast =
            'IMD station forecast lacked usable daily temperatures; using fallback.';
        }
      }

      const needFallbackCurrent = !normalizedImdCurrent;
      const needFallbackForecast = normalizedImdForecast.length === 0;

      const [fallbackCurRes, fallbackFcRes, hourlyRes] = await Promise.allSettled([
        needFallbackCurrent
          ? fetchCurrentWeatherApi(effectiveUserId, latitude, longitude, signal)
          : Promise.resolve(null),
        needFallbackForecast
          ? fetchForecastWeatherApi(effectiveUserId, latitude, longitude, 7, signal)
          : Promise.resolve(null),
        hourlyPromise,
      ]);

      if (signal.aborted) {
        return rejectWithValue('Weather request cancelled.');
      }

      let finalCurrent: CurrentWeatherData | null = normalizedImdCurrent;
      let currentSource: 'IMD' | 'FALLBACK' = 'IMD';
      let fallbackMeta: WeatherMeta | null = null;

      if (needFallbackCurrent) {
        currentSource = 'FALLBACK';
        if (fallbackCurRes.status === 'fulfilled' && fallbackCurRes.value) {
          finalCurrent = fallbackCurRes.value.current;
          fallbackMeta = fallbackCurRes.value.meta;
        }
      }

      let finalForecast: DailyForecastItem[] = normalizedImdForecast;
      let forecastSource: 'IMD' | 'FALLBACK' = 'IMD';

      if (needFallbackForecast) {
        forecastSource = 'FALLBACK';
        if (fallbackFcRes.status === 'fulfilled' && fallbackFcRes.value) {
          finalForecast = fallbackFcRes.value.forecast;
          if (!fallbackMeta) fallbackMeta = fallbackFcRes.value.meta;
        }
      }

      const finalHourly =
        hourlyRes.status === 'fulfilled' && hourlyRes.value ? hourlyRes.value.hourly : [];
      if (!fallbackMeta && hourlyRes.status === 'fulfilled' && hourlyRes.value) {
        fallbackMeta = hourlyRes.value.meta;
      }

      if (!finalCurrent) {
        const curErr =
          fallbackCurRes.status === 'rejected' && fallbackCurRes.reason instanceof Error
            ? fallbackCurRes.reason.message
            : imdStationErrors.current || 'Unable to load current weather telemetry.';
        return rejectWithValue(curErr);
      }

      if (finalForecast.length === 0) {
        const fcErr =
          fallbackFcRes.status === 'rejected' && fallbackFcRes.reason instanceof Error
            ? fallbackFcRes.reason.message
            : imdStationErrors.forecast || 'Unable to load weather forecast.';
        return rejectWithValue(fcErr);
      }

      const imdLat = Number(imdForecast?.Latitude);
      const imdLon = Number(imdForecast?.Longitude);
      const meta: WeatherMeta = fallbackMeta || {
        latitude: Number.isFinite(imdLat) && imdLat !== 0 ? imdLat : latitude,
        longitude: Number.isFinite(imdLon) && imdLon !== 0 ? imdLon : longitude,
        timezone: 'Asia/Kolkata',
        timezone_abbreviation: 'IST',
        elevation: 0,
      };

      return {
        key,
        current: finalCurrent,
        forecast: finalForecast,
        hourly: finalHourly,
        meta,
        weatherSource: {
          current: currentSource,
          forecast: forecastSource,
        },
        imdCurrentStations,
        imdCurrent,
        imdCurrentStationId,
        imdForecast,
        imdForecastStationId,
        imdStationErrors,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return rejectWithValue('Weather request cancelled.');
      }
      return rejectWithValue(
        err instanceof Error && err.message ? err.message : 'Unable to load weather telemetry.'
      );
    }
  },
  {
    condition: ({ userId, latitude, longitude, stationId, force }, { getState }) => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
      const { weather } = getState();
      const effectiveUserId = normalizeOptionalUserId(userId);
      const key = buildWeatherFetchKey(effectiveUserId, latitude, longitude, stationId);

      // Avoid parallel duplicate calls (e.g. StrictMode double-invoke or rapid tab switch)
      if (weather.loading && weather.inFlightKey === key) return false;

      // Return cached weather cleanly within TTL unless forced, coords changed, or stationId changed
      if (
        !force &&
        weather.lastFetchedKey === key &&
        weather.current &&
        weather.forecast.length > 0 &&
        Date.now() - weather.lastFetchedAt < WEATHER_CACHE_TTL_MS
      ) {
        return false;
      }

      return true;
    },
  }
);

/**
 * Forward-geocodes a manually typed registration address into latitude/longitude once.
 */
export const resolveManualAddressCoords = createAsyncThunk<
  WeatherLocation | null,
  {
    addressQuery: string;
    state?: string;
    district?: string;
    village?: string;
    pincode?: string;
    country?: string;
  },
  { state: { weather: WeatherState } }
>(
  'weather/resolveManualAddress',
  async ({ addressQuery, state, district, village, pincode, country }) => {
    const geocoded = await geocodeAddressText(addressQuery);
    if (!geocoded) return null;

    const merged: WeatherLocation = {
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
      state: state || geocoded.state,
      district: district || geocoded.district,
      village: village || geocoded.village,
      pincode: pincode || geocoded.pincode,
      label: formatLocationLabel({
        village: village || geocoded.village,
        district: district || geocoded.district,
        state: state || geocoded.state,
        country,
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
      }),
      source: 'profile',
    };
    saveWeatherLocationStorage(merged);
    return merged;
  },
  {
    condition: ({ addressQuery }, { getState }) => {
      const clean = addressQuery.trim().toLowerCase();
      if (!clean) return false;
      const { weather } = getState();
      return weather.lastGeocodedAddressKey !== clean;
    },
  }
);

export interface FetchWeatherAdvisoryArgs {
  userId?: string;
  locationName?: string;
  latitude: number;
  longitude: number;
  cropStage?: string;
  language?: string;
  forecastDays?: number;
  force?: boolean;
}

interface FetchWeatherAdvisoryResult {
  key: string;
  data: WeatherAdvisoryResponse;
}

export const fetchWeatherAdvisory = createAsyncThunk<
  FetchWeatherAdvisoryResult,
  FetchWeatherAdvisoryArgs,
  { state: { weather: WeatherState }; rejectValue: string }
>(
  'weather/fetchAdvisory',
  async (
    { userId, locationName, latitude, longitude, cropStage, language, forecastDays },
    { rejectWithValue, signal }
  ) => {
    const effectiveCropStage = (cropStage || 'Vegetative').trim().slice(0, 80) || 'Vegetative';
    const effectiveLanguage = (language || 'en').trim().slice(0, 12).toLowerCase() || 'en';
    const effectiveForecastDays = Math.min(16, Math.max(1, Math.trunc(forecastDays || 7)));
    const trimmedLoc = (locationName || '').trim();
    const effectiveLocationName = trimmedLoc.length >= 2 ? trimmedLoc.slice(0, 200) : null;

    const key = buildAdvisoryFetchKey({
      userId,
      latitude,
      longitude,
      cropStage: effectiveCropStage,
      language: effectiveLanguage,
      forecastDays: effectiveForecastDays,
    });

    try {
      const data = await fetchWeatherAdvisoryApi(
        {
          user_id: normalizeAdvisoryUserId(userId),
          location_name: effectiveLocationName,
          latitude,
          longitude,
          crop_stage: effectiveCropStage,
          language: effectiveLanguage,
          forecast_days: effectiveForecastDays,
        },
        signal
      );

      return { key, data };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return rejectWithValue('Weather advisory request cancelled.');
      }
      return rejectWithValue(
        err instanceof Error && err.message ? err.message : 'Unable to generate AI weather advisory.'
      );
    }
  },
  {
    condition: (
      { userId, latitude, longitude, cropStage, language, forecastDays, force },
      { getState }
    ) => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
      const { weather } = getState();
      const key = buildAdvisoryFetchKey({
        userId,
        latitude,
        longitude,
        cropStage: cropStage || weather.advisoryCropStage,
        language,
        forecastDays,
      });

      if (weather.advisoryLoading && weather.inFlightAdvisoryKey === key) {
        return false;
      }

      if (
        !force &&
        weather.lastAdvisoryKey === key &&
        weather.advisory &&
        Date.now() - weather.lastAdvisoryFetchedAt < WEATHER_CACHE_TTL_MS
      ) {
        return false;
      }

      return true;
    },
  }
);

export interface FetchImdDistrictArgs {
  userId?: string;
  districtId?: string;
  latitude?: number;
  longitude?: number;
  force?: boolean;
}

interface FetchImdDistrictResult {
  key: string;
  warnings: ImdDistrictWarning | null;
  districtId: string;
  rainfall: ImdDistrictRainfall | null;
  districtErrors: Pick<ImdWeatherErrors, 'warnings' | 'rainfall'>;
}

export function buildImdDistrictFetchKey(params: {
  userId?: string;
  districtId?: string;
  latitude?: number;
  longitude?: number;
}): string {
  const uid = normalizeOptionalUserId(params.userId) || 'auth';
  const dist = (params.districtId || '').trim();
  if (dist) {
    return `${uid}|id:${dist}`;
  }
  const lat =
    typeof params.latitude === 'number' && Number.isFinite(params.latitude)
      ? params.latitude.toFixed(4)
      : 'na';
  const lon =
    typeof params.longitude === 'number' && Number.isFinite(params.longitude)
      ? params.longitude.toFixed(4)
      : 'na';
  return `${uid}|coords:${lat}|${lon}`;
}

/**
 * Fetches authenticated IMD District Warnings and Rainfall Departure endpoints once in parallel
 * using profile district_id when available or active latitude/longitude coordinates.
 * Strictly skipped when unauthenticated, lacking both district_id and valid coords, already in-flight, or cached.
 */
export const fetchImdDistrictBundle = createAsyncThunk<
  FetchImdDistrictResult,
  FetchImdDistrictArgs,
  { state: { weather: WeatherState }; rejectValue: string }
>(
  'weather/fetchImdDistrictBundle',
  async ({ userId, districtId, latitude, longitude }, { rejectWithValue, signal }) => {
    const cleanDistrictId = (districtId || '').trim() || undefined;
    const hasCoords =
      typeof latitude === 'number' &&
      Number.isFinite(latitude) &&
      typeof longitude === 'number' &&
      Number.isFinite(longitude);

    if (!cleanDistrictId && !hasCoords) {
      return rejectWithValue('IMD district_id or coordinates are required.');
    }
    const key = buildImdDistrictFetchKey({
      userId,
      districtId: cleanDistrictId,
      latitude,
      longitude,
    });

    const [warningsRes, rainfallRes] = await Promise.allSettled([
      fetchImdWarningsApi({ districtId: cleanDistrictId, latitude, longitude }, signal),
      fetchImdRainfallApi({ districtId: cleanDistrictId, latitude, longitude }, signal),
    ]);

    if (signal.aborted) {
      return rejectWithValue('IMD district weather request cancelled.');
    }

    const districtErrors: Pick<ImdWeatherErrors, 'warnings' | 'rainfall'> = {};
    const warnings = warningsRes.status === 'fulfilled' ? warningsRes.value.warning : null;
    const rainfall = rainfallRes.status === 'fulfilled' ? rainfallRes.value.rainfall : null;

    if (warningsRes.status === 'rejected') {
      districtErrors.warnings =
        warningsRes.reason instanceof Error
          ? warningsRes.reason.message
          : 'Unable to load IMD district warnings.';
    }
    if (rainfallRes.status === 'rejected') {
      districtErrors.rainfall =
        rainfallRes.reason instanceof Error
          ? rainfallRes.reason.message
          : 'Unable to load IMD district rainfall.';
    }

    if (warningsRes.status === 'rejected' && rainfallRes.status === 'rejected') {
      return rejectWithValue(
        districtErrors.warnings || districtErrors.rainfall || 'Unable to load IMD district telemetry.'
      );
    }

    const resolvedDistrictId =
      (warningsRes.status === 'fulfilled' ? warningsRes.value.districtId : null) ||
      (rainfallRes.status === 'fulfilled' ? rainfallRes.value.districtId : null) ||
      cleanDistrictId ||
      '';

    return {
      key,
      warnings,
      districtId: resolvedDistrictId,
      rainfall,
      districtErrors,
    };
  },
  {
    condition: ({ userId, districtId, latitude, longitude, force }, { getState }) => {
      if (!getStoredJwt()) return false;
      const cleanDistrictId = (districtId || '').trim() || undefined;
      const hasCoords =
        typeof latitude === 'number' &&
        Number.isFinite(latitude) &&
        typeof longitude === 'number' &&
        Number.isFinite(longitude);
      if (!cleanDistrictId && !hasCoords) return false;

      const { weather } = getState();
      const key = buildImdDistrictFetchKey({
        userId,
        districtId: cleanDistrictId,
        latitude,
        longitude,
      });

      if (weather.imdLoading && weather.imdInFlightKey === key) {
        return false;
      }

      if (
        !force &&
        weather.imdLastFetchedKey === key &&
        Date.now() - weather.imdLastFetchedAt < IMD_CACHE_TTL_MS &&
        (weather.imdWarnings || weather.imdRainfall)
      ) {
        return false;
      }

      return true;
    },
  }
);

const weatherSlice = createSlice({
  name: 'weather',
  initialState,
  reducers: {
    setWeatherLocation(state, action: PayloadAction<WeatherLocation>) {
      const next = action.payload;
      const sameCoords =
        Math.abs(state.location.latitude - next.latitude) < 0.0001 &&
        Math.abs(state.location.longitude - next.longitude) < 0.0001;

      state.location = next;
      state.pendingAddressQuery = null;
      saveWeatherLocationStorage(next);

      if (!sameCoords) {
        state.error = null;
      }
    },
    openLocationModal(state) {
      state.isLocationModalOpen = true;
    },
    closeLocationModal(state) {
      state.isLocationModalOpen = false;
    },
    clearWeatherError(state) {
      if (state.error) state.error = null;
    },
    setAdvisoryCropStage(state, action: PayloadAction<string>) {
      const nextStage = action.payload.trim() || CROP_STAGE_OPTIONS[2];
      if (state.advisoryCropStage !== nextStage) {
        state.advisoryCropStage = nextStage;
        state.advisoryError = null;
      }
    },
    clearWeatherAdvisoryError(state) {
      if (state.advisoryError) state.advisoryError = null;
    },
    selectImdStation(state, action: PayloadAction<string>) {
      const targetId = action.payload.trim();
      if (!targetId) return;
      const found = state.imdCurrentStations.find(
        (st) => String(st['Station Id']).trim() === targetId
      );
      if (found) {
        state.imdCurrent = found;
        state.imdCurrentStationId = String(found['Station Id']).trim();
        const normalized = normalizeImdCurrentToWeatherData(found);
        if (normalized) {
          state.current = normalized;
          state.weatherSource.current = 'IMD';
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWeatherBundle.pending, (state, action) => {
        const { userId, latitude, longitude, stationId } = action.meta.arg;
        const effectiveUserId = normalizeOptionalUserId(userId);
        state.loading = true;
        state.error = null;
        state.inFlightKey = buildWeatherFetchKey(effectiveUserId, latitude, longitude, stationId);
      })
      .addCase(fetchWeatherBundle.fulfilled, (state, action) => {
        // Ignore stale response if user switched coordinates mid-flight
        const currentCoordsSegment = `|${state.location.latitude.toFixed(4)}|${state.location.longitude.toFixed(4)}|`;
        if (!action.payload.key.includes(currentCoordsSegment)) {
          return;
        }
        state.loading = false;
        state.error = null;
        state.inFlightKey = null;
        state.lastFetchedKey = action.payload.key;
        state.lastFetchedAt = Date.now();
        state.current = action.payload.current;
        state.forecast = action.payload.forecast;
        state.hourly = action.payload.hourly;
        state.meta = action.payload.meta;
        state.weatherSource = action.payload.weatherSource;
        state.imdCurrentStations = action.payload.imdCurrentStations;
        state.imdCurrent = action.payload.imdCurrent;
        state.imdCurrentStationId = action.payload.imdCurrentStationId;
        state.imdForecast = action.payload.imdForecast;
        state.imdForecastStationId = action.payload.imdForecastStationId;
        state.imdSectionErrors = {
          warnings: state.imdSectionErrors.warnings,
          rainfall: state.imdSectionErrors.rainfall,
          ...action.payload.imdStationErrors,
        };
      })
      .addCase(fetchWeatherBundle.rejected, (state, action) => {
        const { userId, latitude, longitude, stationId } = action.meta.arg;
        const effectiveUserId = normalizeOptionalUserId(userId);
        const rejectedKey = buildWeatherFetchKey(effectiveUserId, latitude, longitude, stationId);
        if (state.inFlightKey && state.inFlightKey !== rejectedKey) {
          return;
        }
        state.loading = false;
        state.inFlightKey = null;
        if (!action.meta.condition) {
          state.error = action.payload || 'Unable to load weather telemetry.';
        }
      })
      .addCase(resolveManualAddressCoords.pending, (state, action) => {
        state.lastGeocodedAddressKey = action.meta.arg.addressQuery.trim().toLowerCase();
      })
      .addCase(resolveManualAddressCoords.fulfilled, (state, action) => {
        if (action.payload && state.location.source !== 'gps') {
          state.location = action.payload;
          state.pendingAddressQuery = null;
        }
      })
      .addCase(fetchWeatherAdvisory.pending, (state, action) => {
        const arg = action.meta.arg;
        state.advisoryLoading = true;
        state.advisoryError = null;
        state.inFlightAdvisoryKey = buildAdvisoryFetchKey({
          userId: arg.userId,
          latitude: arg.latitude,
          longitude: arg.longitude,
          cropStage: arg.cropStage || state.advisoryCropStage,
          language: arg.language,
          forecastDays: arg.forecastDays,
        });
      })
      .addCase(fetchWeatherAdvisory.fulfilled, (state, action) => {
        const currentCoordsSegment = `|${state.location.latitude.toFixed(4)}|${state.location.longitude.toFixed(4)}|`;
        if (!action.payload.key.includes(currentCoordsSegment)) {
          return;
        }
        state.advisoryLoading = false;
        state.advisoryError = null;
        state.inFlightAdvisoryKey = null;
        state.lastAdvisoryKey = action.payload.key;
        state.lastAdvisoryFetchedAt = Date.now();
        state.advisory = action.payload.data;
      })
      .addCase(fetchWeatherAdvisory.rejected, (state, action) => {
        const arg = action.meta.arg;
        const rejectedKey = buildAdvisoryFetchKey({
          userId: arg.userId,
          latitude: arg.latitude,
          longitude: arg.longitude,
          cropStage: arg.cropStage || state.advisoryCropStage,
          language: arg.language,
          forecastDays: arg.forecastDays,
        });
        if (state.inFlightAdvisoryKey && state.inFlightAdvisoryKey !== rejectedKey) {
          return;
        }
        state.advisoryLoading = false;
        state.inFlightAdvisoryKey = null;
        if (!action.meta.condition) {
          state.advisoryError =
            action.payload || 'Unable to generate AI weather advisory.';
        }
      })
      // Sync weather location when a user completes registration with GPS coords or address
      .addCase(registerUser.fulfilled, (state, action) => {
        if (action.payload.outcome === 'otp_required') {
          const reg = action.payload.registerData;
          const label = formatLocationLabel({
            village: reg.village,
            district: reg.district,
            state: reg.state,
            country: reg.country,
            latitude: reg.latitude,
            longitude: reg.longitude,
          });
          if (
            typeof reg.latitude === 'number' &&
            Number.isFinite(reg.latitude) &&
            typeof reg.longitude === 'number' &&
            Number.isFinite(reg.longitude)
          ) {
            state.location = {
              latitude: reg.latitude,
              longitude: reg.longitude,
              label,
              state: reg.state,
              district: reg.district,
              village: reg.village,
              pincode: reg.pincode,
              source: 'gps',
            };
            state.pendingAddressQuery = null;
            saveWeatherLocationStorage(state.location);
          } else if (state.location.source !== 'gps' && (reg.village || reg.district || reg.state)) {
            state.location = {
              ...state.location,
              label,
              state: reg.state,
              district: reg.district,
              village: reg.village,
              pincode: reg.pincode,
              source: 'profile',
            };
            state.pendingAddressQuery = [reg.village, reg.district, reg.state, reg.country]
              .filter(Boolean)
              .join(', ');
            saveWeatherLocationStorage(state.location);
          }
        } else if (action.payload.outcome === 'authenticated') {
          const u = action.payload.user;
          const label = formatLocationLabel({
            village: u.village,
            district: u.district,
            state: u.state,
            country: u.country,
            latitude: u.latitude,
            longitude: u.longitude,
          });
          if (typeof u.latitude === 'number' && typeof u.longitude === 'number') {
            state.location = {
              latitude: u.latitude,
              longitude: u.longitude,
              label,
              state: u.state,
              district: u.district,
              village: u.village,
              pincode: u.pincode,
              source: 'gps',
            };
            saveWeatherLocationStorage(state.location);
          } else if (state.location.source === 'default' && (u.village || u.district || u.state)) {
            state.location = {
              ...state.location,
              label,
              state: u.state,
              district: u.district,
              village: u.village,
              pincode: u.pincode,
              source: 'profile',
            };
            state.pendingAddressQuery = [u.village, u.district, u.state, u.country]
              .filter(Boolean)
              .join(', ');
            saveWeatherLocationStorage(state.location);
          }
        }
      })
      .addCase(verifyOtp.fulfilled, (state, action) => {
        const u = action.payload.user;
        if (typeof u.latitude === 'number' && typeof u.longitude === 'number') {
          const nextLoc: WeatherLocation = {
            latitude: u.latitude,
            longitude: u.longitude,
            label: formatLocationLabel({
              village: u.village,
              district: u.district,
              state: u.state,
              country: u.country,
              latitude: u.latitude,
              longitude: u.longitude,
            }),
            state: u.state,
            district: u.district,
            village: u.village,
            pincode: u.pincode,
            source: 'gps',
          };
          state.location = nextLoc;
          saveWeatherLocationStorage(nextLoc);
        } else if (state.location.source === 'default' && (u.village || u.district || u.state)) {
          const nextLabel = formatLocationLabel({
            village: u.village,
            district: u.district,
            state: u.state,
            country: u.country,
          });
          state.location = {
            ...state.location,
            label: nextLabel,
            state: u.state,
            district: u.district,
            village: u.village,
            pincode: u.pincode,
            source: 'profile',
          };
          state.pendingAddressQuery = [u.village, u.district, u.state, u.country]
            .filter(Boolean)
            .join(', ');
          saveWeatherLocationStorage(state.location);
        }
      })
      .addCase(fetchUserProfile.fulfilled, (state, action) => {
        const u = action.payload.user;
        if (
          (state.location.source === 'default' || state.location.source === 'profile') &&
          typeof u.latitude === 'number' &&
          Number.isFinite(u.latitude) &&
          typeof u.longitude === 'number' &&
          Number.isFinite(u.longitude)
        ) {
          const nextLoc: WeatherLocation = {
            latitude: u.latitude,
            longitude: u.longitude,
            label: formatLocationLabel({
              village: u.village,
              district: u.district,
              state: u.state,
              country: u.country,
              latitude: u.latitude,
              longitude: u.longitude,
            }),
            country: u.country,
            state: u.state,
            district: u.district,
            village: u.village,
            pincode: u.pincode,
            source: 'profile',
          };
          state.location = nextLoc;
          state.pendingAddressQuery = null;
          saveWeatherLocationStorage(nextLoc);
        }
      })
      .addCase(fetchImdDistrictBundle.pending, (state, action) => {
        const arg = action.meta.arg;
        state.imdLoading = true;
        state.imdError = null;
        state.imdInFlightKey = buildImdDistrictFetchKey({
          userId: arg.userId,
          districtId: arg.districtId,
          latitude: arg.latitude,
          longitude: arg.longitude,
        });
      })
      .addCase(fetchImdDistrictBundle.fulfilled, (state, action) => {
        state.imdLoading = false;
        state.imdError = null;
        state.imdInFlightKey = null;
        state.imdLastFetchedKey = action.payload.key;
        state.imdLastFetchedAt = Date.now();
        state.imdWarnings = action.payload.warnings;
        state.imdDistrictId = action.payload.districtId;
        state.imdRainfall = action.payload.rainfall;
        state.imdSectionErrors = {
          current: state.imdSectionErrors.current,
          forecast: state.imdSectionErrors.forecast,
          ...action.payload.districtErrors,
        };
      })
      .addCase(fetchImdDistrictBundle.rejected, (state, action) => {
        const arg = action.meta.arg;
        const rejectedKey = buildImdDistrictFetchKey({
          userId: arg.userId,
          districtId: arg.districtId,
          latitude: arg.latitude,
          longitude: arg.longitude,
        });
        if (state.imdInFlightKey && state.imdInFlightKey !== rejectedKey) {
          return;
        }
        state.imdLoading = false;
        state.imdInFlightKey = null;
        if (!action.meta.condition) {
          state.imdError = action.payload || 'Unable to load IMD district weather services.';
        }
      })
      .addCase(logout, (state) => {
        state.imdCurrentStations = [];
        state.imdCurrent = null;
        state.imdCurrentStationId = null;
        state.imdForecast = null;
        state.imdForecastStationId = null;
        state.imdWarnings = null;
        state.imdDistrictId = null;
        state.imdRainfall = null;
        state.imdLoading = false;
        state.imdError = null;
        state.imdSectionErrors = {};
        state.imdLastFetchedKey = null;
        state.imdInFlightKey = null;
        state.imdLastFetchedAt = 0;
        state.weatherSource = {
          current: null,
          forecast: null,
        };
      });
  },
});

export const {
  setWeatherLocation,
  openLocationModal,
  closeLocationModal,
  clearWeatherError,
  setAdvisoryCropStage,
  clearWeatherAdvisoryError,
  selectImdStation,
} = weatherSlice.actions;

// Primitive & memoized selectors prevent unnecessary re-renders
export const selectWeatherLocationLabel = (state: { weather: WeatherState }) =>
  state.weather.location.label;

export const selectWeatherLatitude = (state: { weather: WeatherState }) =>
  state.weather.location.latitude;

export const selectWeatherLongitude = (state: { weather: WeatherState }) =>
  state.weather.location.longitude;

export const selectWeatherLocationSource = (state: { weather: WeatherState }) =>
  state.weather.location.source;

export const selectIsLocationModalOpen = (state: { weather: WeatherState }) =>
  state.weather.isLocationModalOpen;

export const selectPendingAddressQuery = (state: { weather: WeatherState }) =>
  state.weather.pendingAddressQuery;

export const selectWeatherLocation = (state: { weather: WeatherState }) => state.weather.location;

export const selectWeatherUi = createSelector(
  [
    (state: { weather: WeatherState }) => state.weather.location,
    (state: { weather: WeatherState }) => state.weather.meta,
    (state: { weather: WeatherState }) => state.weather.current,
    (state: { weather: WeatherState }) => state.weather.forecast,
    (state: { weather: WeatherState }) => state.weather.hourly,
    (state: { weather: WeatherState }) => state.weather.loading,
    (state: { weather: WeatherState }) => state.weather.error,
    (state: { weather: WeatherState }) => state.weather.lastFetchedAt,
    (state: { weather: WeatherState }) => state.weather.weatherSource,
  ],
  (location, meta, current, forecast, hourly, loading, error, lastFetchedAt, weatherSource) => ({
    location,
    meta,
    current,
    forecast,
    hourly,
    loading,
    error,
    lastFetchedAt,
    weatherSource,
  })
);

export const selectWeatherAdvisoryUi = createSelector(
  [
    (state: { weather: WeatherState }) => state.weather.advisory,
    (state: { weather: WeatherState }) => state.weather.advisoryLoading,
    (state: { weather: WeatherState }) => state.weather.advisoryError,
    (state: { weather: WeatherState }) => state.weather.advisoryCropStage,
    (state: { weather: WeatherState }) => state.weather.lastAdvisoryFetchedAt,
  ],
  (advisory, advisoryLoading, advisoryError, advisoryCropStage, lastAdvisoryFetchedAt) => ({
    advisory,
    advisoryLoading,
    advisoryError,
    advisoryCropStage,
    lastAdvisoryFetchedAt,
  })
);

export const selectWeatherImdUi = createSelector(
  [
    (state: { weather: WeatherState }) => state.weather.imdCurrentStations,
    (state: { weather: WeatherState }) => state.weather.imdCurrent,
    (state: { weather: WeatherState }) => state.weather.imdCurrentStationId,
    (state: { weather: WeatherState }) => state.weather.imdForecast,
    (state: { weather: WeatherState }) => state.weather.imdForecastStationId,
    (state: { weather: WeatherState }) => state.weather.imdWarnings,
    (state: { weather: WeatherState }) => state.weather.imdDistrictId,
    (state: { weather: WeatherState }) => state.weather.imdRainfall,
    (state: { weather: WeatherState }) => state.weather.imdLoading,
    (state: { weather: WeatherState }) => state.weather.imdError,
    (state: { weather: WeatherState }) => state.weather.imdSectionErrors,
    (state: { weather: WeatherState }) => state.weather.weatherSource,
  ],
  (
    stations,
    current,
    currentStationId,
    forecast,
    forecastStationId,
    warnings,
    districtId,
    rainfall,
    loading,
    error,
    sectionErrors,
    weatherSource
  ) => ({
    stations,
    current,
    currentStationId,
    forecast,
    forecastStationId,
    warnings,
    districtId,
    rainfall,
    loading,
    error,
    sectionErrors,
    weatherSource,
  })
);

export default weatherSlice.reducer;
