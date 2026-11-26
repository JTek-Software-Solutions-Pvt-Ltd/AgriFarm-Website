/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CurrentWeatherData,
  DailyForecastItem,
  ImdCurrentObservation,
  ImdDistrictRainfall,
  ImdDistrictWarning,
  ImdForecastObservation,
  UserProfile,
  WeatherLocation,
} from '../../../shared/types';
import { getImdApiBaseUrl } from '../../../shared/config/api';
import { getAuthHeaders, getStoredJwt } from '../../auth/utils/jwt';

export const IMD_WEATHER_ENDPOINTS = {
  CURRENT: '/api/weather/imd/current',
  FORECAST: '/api/weather/imd/forecast',
  WARNINGS: '/api/weather/imd/warnings',
  RAINFALL: '/api/weather/imd/rainfall',
} as const;

export interface ImdQueryParams {
  latitude?: number | null;
  longitude?: number | null;
  stationId?: string | null;
  districtId?: string | null;
}

function requireAuthHeaders(): Record<string, string> {
  const token = getStoredJwt();
  if (!token) {
    throw new Error('Sign in required to access authenticated IMD weather services.');
  }
  return {
    accept: '*/*',
    ...getAuthHeaders(),
  };
}

function buildImdUrl(path: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      search.set(key, String(val).trim());
    }
  }
  const qs = search.toString();
  const base = getImdApiBaseUrl();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

async function fetchImdJson<T>(url: string, signal?: AbortSignal): Promise<{
  station_id?: string | null;
  district_id?: string | null;
  data: T[];
}> {
  const headers = requireAuthHeaders();
  const res = await fetch(url, {
    method: 'GET',
    headers,
    signal,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true || !Array.isArray(json.data) || json.data.length === 0) {
    throw new Error(
      typeof json?.message === 'string' && json.message
        ? json.message
        : `IMD endpoint returned HTTP ${res.status}.`
    );
  }

  return {
    station_id: json.station_id ?? null,
    district_id: json.district_id ?? null,
    data: json.data as T[],
  };
}

function buildImdTargetParams(
  primaryKey: 'station_id' | 'district_id',
  primaryValue: string | null | undefined,
  latitude?: number | null,
  longitude?: number | null
): Record<string, string | number> | null {
  const cleanId = (primaryValue || '').trim();
  if (cleanId) {
    return { [primaryKey]: cleanId };
  }
  if (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude)
  ) {
    return { latitude, longitude };
  }
  return null;
}

export async function fetchImdCurrentApi(
  params: { stationId?: string | null; latitude?: number | null; longitude?: number | null },
  signal?: AbortSignal
): Promise<{ stationId: string | null; stations: ImdCurrentObservation[] }> {
  const queryParams = buildImdTargetParams(
    'station_id',
    params.stationId,
    params.latitude,
    params.longitude
  );
  if (!queryParams) {
    throw new Error('IMD station_id or coordinates are required for current station weather.');
  }
  const url = buildImdUrl(IMD_WEATHER_ENDPOINTS.CURRENT, queryParams);
  const res = await fetchImdJson<ImdCurrentObservation>(url, signal);
  return {
    stationId: res.station_id ?? (typeof queryParams.station_id === 'string' ? queryParams.station_id : null),
    stations: res.data,
  };
}

export async function fetchImdForecastApi(
  params: { stationId?: string | null; latitude?: number | null; longitude?: number | null },
  signal?: AbortSignal
): Promise<{ stationId: string | null; forecast: ImdForecastObservation | null }> {
  const queryParams = buildImdTargetParams(
    'station_id',
    params.stationId,
    params.latitude,
    params.longitude
  );
  if (!queryParams) {
    throw new Error('IMD station_id or coordinates are required for station forecast.');
  }
  const url = buildImdUrl(IMD_WEATHER_ENDPOINTS.FORECAST, queryParams);
  const res = await fetchImdJson<ImdForecastObservation>(url, signal);
  const item = res.data[0] || null;
  return {
    stationId:
      res.station_id ||
      item?.Station_Code ||
      (typeof queryParams.station_id === 'string' ? queryParams.station_id : null),
    forecast: item,
  };
}

export async function fetchImdWarningsApi(
  params: { districtId?: string | null; latitude?: number | null; longitude?: number | null },
  signal?: AbortSignal
): Promise<{ districtId: string | null; warning: ImdDistrictWarning | null }> {
  const queryParams = buildImdTargetParams(
    'district_id',
    params.districtId,
    params.latitude,
    params.longitude
  );
  if (!queryParams) {
    throw new Error('IMD district_id or coordinates are required for district weather warnings.');
  }
  const url = buildImdUrl(IMD_WEATHER_ENDPOINTS.WARNINGS, queryParams);
  const res = await fetchImdJson<ImdDistrictWarning>(url, signal);
  const item = res.data[0] || null;
  return {
    districtId:
      res.district_id ||
      item?.Obj_id ||
      (typeof queryParams.district_id === 'string' ? queryParams.district_id : null),
    warning: item,
  };
}

export async function fetchImdRainfallApi(
  params: { districtId?: string | null; latitude?: number | null; longitude?: number | null },
  signal?: AbortSignal
): Promise<{ districtId: string | null; rainfall: ImdDistrictRainfall | null }> {
  const queryParams = buildImdTargetParams(
    'district_id',
    params.districtId,
    params.latitude,
    params.longitude
  );
  if (!queryParams) {
    throw new Error('IMD district_id or coordinates are required for district rainfall departure.');
  }
  const url = buildImdUrl(IMD_WEATHER_ENDPOINTS.RAINFALL, queryParams);
  const res = await fetchImdJson<ImdDistrictRainfall>(url, signal);
  const item = res.data[0] || null;
  return {
    districtId:
      res.district_id ||
      item?.OBJ_ID ||
      (typeof queryParams.district_id === 'string' ? queryParams.district_id : null),
    rainfall: item,
  };
}

export function doesLocationMatchProfile(
  location: WeatherLocation,
  user: UserProfile | null | undefined
): boolean {
  if (!user) return false;
  const userDist = (user.district || '').trim().toLowerCase();
  const locDist = (location.district || '').trim().toLowerCase();
  if (userDist && locDist && userDist === locDist) {
    return true;
  }
  const hasUserCoords =
    typeof user.latitude === 'number' &&
    Number.isFinite(user.latitude) &&
    typeof user.longitude === 'number' &&
    Number.isFinite(user.longitude);
  if (hasUserCoords) {
    const threshold = userDist && locDist && userDist !== locDist ? 0.15 : 0.25;
    return (
      Math.abs(location.latitude - (user.latitude as number)) <= threshold &&
      Math.abs(location.longitude - (user.longitude as number)) <= threshold
    );
  }
  return location.source === 'profile' || location.source === 'default';
}

export function resolveProfileImdIds(
  location: WeatherLocation,
  user: UserProfile | null | undefined
): { stationId?: string; districtId?: string } {
  if (!user || !doesLocationMatchProfile(location, user)) {
    return {};
  }
  const stationId =
    (user.imdStationId || user.cityForecastStationCode || '').trim() || undefined;
  const districtId = (user.imdDistrictId || '').trim() || undefined;
  return { stationId, districtId };
}

function toFiniteNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const parsed = Number(String(val).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function mapImdTextToWmoCode(text?: string | number | null): number {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return 1;
  if (raw.includes('thunder') || raw.includes('squall') || raw.includes('hail')) return 95;
  if (raw.includes('heavy rain')) return 65;
  if (raw.includes('rain') || raw.includes('shower')) return 61;
  if (raw.includes('drizzle')) return 51;
  if (raw.includes('fog') || raw.includes('mist') || raw.includes('haze') || raw.includes('smoke')) {
    return 45;
  }
  if (raw.includes('overcast') || raw.includes('generally cloudy')) return 3;
  if (raw.includes('partly cloudy') || raw.includes('cloudy')) return 2;
  if (raw.includes('mainly clear') || raw.includes('clear') || raw.includes('sunny')) return 0;
  return 1;
}

function inferPrecipProbFromText(text?: string | null): number {
  const raw = String(text || '').toLowerCase();
  if (raw.includes('thunder') || raw.includes('heavy rain')) return 80;
  if (raw.includes('rain') || raw.includes('shower')) return 60;
  if (raw.includes('drizzle')) return 40;
  if (raw.includes('overcast') || raw.includes('cloudy')) return 20;
  return 5;
}

function addDaysIso(baseIso: string, offsetDays: number): string {
  const parsed = new Date(`${baseIso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + offsetDays);
    return fallback.toISOString().slice(0, 10);
  }
  parsed.setDate(parsed.getDate() + offsetDays);
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseClockTime(dateIso: string, hhmm?: string | null, fallback = '06:00'): string {
  const clean = String(hhmm || '').trim();
  if (/^\d{1,2}:\d{2}/.test(clean)) {
    const [h, m] = clean.split(':');
    return `${dateIso}T${h.padStart(2, '0')}:${m.slice(0, 2)}`;
  }
  return `${dateIso}T${fallback}`;
}

/**
 * Validates and converts an IMD Current Observation record into UI CurrentWeatherData.
 * Returns null if essential fields (like numeric temperature) are missing/improper so fallback runs.
 */
export function normalizeImdCurrentToWeatherData(
  obs: ImdCurrentObservation | null | undefined
): CurrentWeatherData | null {
  if (!obs) return null;
  const temp = toFiniteNum(obs.Temperature);
  if (temp === null) return null;

  const humidity = toFiniteNum(obs.Humidity) ?? 55;
  const feelsLike = toFiniteNum(obs['Feel Like']) ?? temp;
  const windSpeed = toFiniteNum(obs['Wind Speed KMPH']) ?? 0;
  const windDir = toFiniteNum(obs['Wind Direction']) ?? 0;
  const rainfall = toFiniteNum(obs['Last 24 hrs Rainfall']) ?? 0;
  const nebulosity = toFiniteNum(obs.Nebulosity);
  const cloudCover =
    nebulosity !== null ? Math.min(100, Math.max(0, Math.round((nebulosity / 8) * 100))) : 15;

  const obsDate =
    typeof obs['Date of Observation'] === 'string' && obs['Date of Observation'].trim()
      ? obs['Date of Observation'].trim()
      : new Date().toISOString().slice(0, 10);
  const obsHourRaw = toFiniteNum(obs.Time);
  const obsHour =
    obsHourRaw !== null ? Math.min(23, Math.max(0, Math.trunc(obsHourRaw))) : new Date().getHours();
  const timeIso = `${obsDate}T${String(obsHour).padStart(2, '0')}:00`;

  return {
    time: timeIso,
    interval: 3600,
    temperature_2m: temp,
    relative_humidity_2m: humidity,
    apparent_temperature: feelsLike,
    is_day: obsHour >= 6 && obsHour < 18 ? 1 : 0,
    precipitation: rainfall,
    rain: rainfall,
    weather_code: mapImdTextToWmoCode(obs.WEATHER_MESSAGE || obs['Weather Code']),
    cloud_cover: cloudCover,
    wind_speed_10m: windSpeed,
    wind_direction_10m: windDir,
    wind_gusts_10m: windSpeed,
  };
}

/**
 * Validates and converts an IMD 7-Day Forecast record into UI DailyForecastItem[].
 * Returns empty array if no usable forecast days exist so fallback /api/weather/forecast runs.
 */
export function normalizeImdForecastToDailyItems(
  forecast: ImdForecastObservation | null | undefined,
  fallbackWindSpeed = 10
): DailyForecastItem[] {
  if (!forecast) return [];

  const baseDate =
    typeof forecast.Date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(forecast.Date.trim())
      ? forecast.Date.trim().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

  const pastRainRaw = toFiniteNum(forecast.Past_24_hrs_Rainfall) ?? 0;

  const rawDays: Array<{
    max: number | null;
    min: number | null;
    text?: string | null;
    rainMm: number;
  }> = [
    {
      max:
        toFiniteNum(forecast.Todays_Forecast_Max_Temp) ??
        toFiniteNum(forecast.Today_Max_temp) ??
        toFiniteNum(forecast.Previous_Day_Max_temp),
      min:
        toFiniteNum(forecast.Todays_Forecast_Min_temp) ??
        toFiniteNum(forecast.Today_Min_temp),
      text: forecast.Todays_Forecast,
      rainMm: pastRainRaw,
    },
    {
      max: toFiniteNum(forecast.Day_2_Max_Temp),
      min: toFiniteNum(forecast.Day_2_Min_temp),
      text: forecast.Day_2_Forecast,
      rainMm: 0,
    },
    {
      max: toFiniteNum(forecast.Day_3_Max_Temp),
      min: toFiniteNum(forecast.Day_3_Min_temp),
      text: forecast.Day_3_Forecast,
      rainMm: 0,
    },
    {
      max: toFiniteNum(forecast.Day_4_Max_Temp),
      min: toFiniteNum(forecast.Day_4_Min_temp),
      text: forecast.Day_4_Forecast,
      rainMm: 0,
    },
    {
      max: toFiniteNum(forecast.Day_5_Max_Temp),
      min: toFiniteNum(forecast.Day_5_Min_temp),
      text: forecast.Day_5_Forecast,
      rainMm: 0,
    },
    {
      max: toFiniteNum(forecast.Day_6_Max_Temp),
      min: toFiniteNum(forecast.Day_6_Min_temp),
      text: forecast.Day_6_Forecast,
      rainMm: 0,
    },
    {
      max: toFiniteNum(forecast.Day_7_Max_Temp),
      min: toFiniteNum(forecast.Day_7_Min_temp),
      text: forecast.Day_7_Forecast,
      rainMm: 0,
    },
  ];

  const validDays = rawDays
    .map((d, idx) => {
      if (d.max === null && d.min === null) return null;
      const date = addDaysIso(baseDate, idx);
      const maxT = d.max ?? (d.min !== null ? d.min + 8 : 30);
      const minT = d.min ?? (d.max !== null ? d.max - 8 : 20);
      return {
        date,
        weather_code: mapImdTextToWmoCode(d.text),
        temperature_2m_max: maxT,
        temperature_2m_min: minT,
        apparent_temperature_max: maxT,
        apparent_temperature_min: minT,
        precipitation_sum: d.rainMm,
        precipitation_probability_max: inferPrecipProbFromText(d.text),
        sunrise: parseClockTime(date, forecast.Sunrise_time, '06:00'),
        sunset: parseClockTime(date, forecast.Sunset_time, '18:00'),
        wind_speed_10m_max: fallbackWindSpeed,
      } satisfies DailyForecastItem;
    })
    .filter((item): item is DailyForecastItem => item !== null);

  return validDays;
}

/**
 * When IMD current returns a multi-station directory (station_id === null),
 * selects the closest matching observation station using forecast code or location labels
 * without triggering an extra network request.
 */
export function pickBestImdCurrentStation(
  stations: ImdCurrentObservation[],
  hints: {
    explicitStationId?: string | null;
    forecastStationCode?: string | null;
    forecastStationName?: string | null;
    village?: string | null;
    district?: string | null;
    state?: string | null;
    label?: string | null;
  }
): ImdCurrentObservation | null {
  if (!stations || stations.length === 0) return null;
  if (stations.length === 1) return stations[0];

  const candidateIds = [hints.explicitStationId, hints.forecastStationCode]
    .map((v) => (v || '').trim())
    .filter(Boolean);

  for (const id of candidateIds) {
    const byId = stations.find((s) => String(s['Station Id']).trim() === id);
    if (byId) return byId;
  }

  const nameTokens = [
    hints.forecastStationName,
    hints.village,
    hints.district,
    hints.label?.split(',')[0],
    hints.state,
  ]
    .map((v) => (v || '').trim().toLowerCase())
    .filter((v) => v.length >= 3);

  for (const token of nameTokens) {
    const exactOrPrefix = stations.find((s) =>
      String(s.Station || '').toLowerCase().includes(token)
    );
    if (exactOrPrefix) return exactOrPrefix;
  }

  return null;
}

export function describeImdWarningColor(colorCode?: string | null, warningCode?: string | null): {
  label: string;
  badgeCls: string;
  dotCls: string;
} {
  const color = String(colorCode || '').trim();
  const code = String(warningCode || '').trim();
  if (color === '1') {
    return {
      label: code && code !== '1' ? `Red Alert (Code ${code})` : 'Red • Take Action',
      badgeCls: 'bg-red-50 border-red-200 text-red-900',
      dotCls: 'bg-red-600',
    };
  }
  if (color === '2') {
    return {
      label: code && code !== '1' ? `Orange Alert (Code ${code})` : 'Orange • Be Prepared',
      badgeCls: 'bg-orange-50 border-orange-200 text-orange-900',
      dotCls: 'bg-orange-500',
    };
  }
  if (color === '3') {
    return {
      label: code && code !== '1' ? `Yellow Watch (Code ${code})` : 'Yellow • Be Updated',
      badgeCls: 'bg-amber-50 border-amber-200 text-amber-900',
      dotCls: 'bg-amber-500',
    };
  }
  return {
    label: 'Green • No Warning',
    badgeCls: 'bg-emerald-50 border-emerald-200 text-[#113E2E]',
    dotCls: 'bg-emerald-600',
  };
}

export function describeImdRainfallCategory(category?: string | null): {
  label: string;
  badgeCls: string;
} {
  const code = String(category || '').trim().toUpperCase();
  switch (code) {
    case 'LE':
      return { label: 'Large Excess (LE)', badgeCls: 'bg-sky-100 text-sky-900 border-sky-200' };
    case 'E':
      return { label: 'Excess (E)', badgeCls: 'bg-emerald-100 text-emerald-900 border-emerald-200' };
    case 'N':
      return { label: 'Normal (N)', badgeCls: 'bg-[#F0F7F2] text-[#113E2E] border-[#cbe1d2]' };
    case 'D':
      return { label: 'Deficient (D)', badgeCls: 'bg-amber-100 text-amber-900 border-amber-200' };
    case 'LD':
      return { label: 'Large Deficient (LD)', badgeCls: 'bg-red-100 text-red-900 border-red-200' };
    case 'NR':
      return { label: 'No Rain (NR)', badgeCls: 'bg-slate-100 text-slate-700 border-slate-200' };
    default:
      return { label: code || 'N/A', badgeCls: 'bg-slate-100 text-slate-700 border-slate-200' };
  }
}

export function cleanImdPeriodText(raw?: string | null): string {
  if (!raw) return '--';
  return raw
    .replace(/[\r\n]/g, '')
    .replace(/,+/g, ' ')
    .trim() || '--';
}
