/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CloudRain,
  Compass,
  Droplets,
  Gauge,
  Lock,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sunrise,
  Sunset,
  Thermometer,
  Wind,
} from 'lucide-react';
import {
  ImdCurrentObservation,
  ImdDistrictRainfall,
  ImdDistrictWarning,
  ImdForecastObservation,
  ImdWeatherErrors,
} from '../../../shared/types';
import {
  cleanImdPeriodText,
  describeImdRainfallCategory,
  describeImdWarningColor,
} from '../services/imdWeatherApi';

interface ImdWeatherSectionProps {
  isAuthenticated: boolean;
  locationLabel: string;
  current: ImdCurrentObservation | null;
  stations: ImdCurrentObservation[];
  currentStationId: string | null;
  forecast: ImdForecastObservation | null;
  forecastStationId: string | null;
  warnings: ImdDistrictWarning | null;
  districtId: string | null;
  rainfall: ImdDistrictRainfall | null;
  loading: boolean;
  error: string | null;
  sectionErrors: ImdWeatherErrors;
  weatherSource?: {
    current: 'IMD' | 'FALLBACK' | null;
    forecast: 'IMD' | 'FALLBACK' | null;
  };
  onRefresh: () => void;
  onSelectStation: (stationId: string) => void;
  onOpenAuth: () => void;
}

type ImdTab = 'observation' | 'forecast' | 'warnings' | 'rainfall';

function formatFieldVal(value: string | number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || String(value).trim() === '') return '--';
  return `${String(value).trim()}${suffix}`;
}

export const ImdWeatherSection: React.FC<ImdWeatherSectionProps> = memo(({
  isAuthenticated,
  locationLabel,
  current,
  stations,
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
  onRefresh,
  onSelectStation,
  onOpenAuth,
}) => {
  const [activeTab, setActiveTab] = useState<ImdTab>('observation');

  const sortedStations = useMemo(() => {
    if (stations.length <= 1) return stations;
    return [...stations].sort((a, b) =>
      String(a.Station || '').localeCompare(String(b.Station || ''))
    );
  }, [stations]);

  const warningDays = useMemo(() => {
    if (!warnings) return [];
    return [
      { day: 'Day 1 (Today)', color: warnings.Day1_Color, code: warnings.Day_1 },
      { day: 'Day 2', color: warnings.Day2_Color, code: warnings.Day_2 },
      { day: 'Day 3', color: warnings.Day3_Color, code: warnings.Day_3 },
      { day: 'Day 4', color: warnings.Day4_Color, code: warnings.Day_4 },
      { day: 'Day 5', color: warnings.Day5_Color, code: warnings.Day_5 },
    ].map((entry) => ({
      ...entry,
      meta: describeImdWarningColor(entry.color, entry.code),
    }));
  }, [warnings]);

  const forecastDays = useMemo(() => {
    if (!forecast) return [];
    return [
      {
        day: 'Today',
        max: forecast.Todays_Forecast_Max_Temp ?? forecast.Today_Max_temp,
        min: forecast.Todays_Forecast_Min_temp ?? forecast.Today_Min_temp,
        text: forecast.Todays_Forecast,
      },
      { day: 'Day 2', max: forecast.Day_2_Max_Temp, min: forecast.Day_2_Min_temp, text: forecast.Day_2_Forecast },
      { day: 'Day 3', max: forecast.Day_3_Max_Temp, min: forecast.Day_3_Min_temp, text: forecast.Day_3_Forecast },
      { day: 'Day 4', max: forecast.Day_4_Max_Temp, min: forecast.Day_4_Min_temp, text: forecast.Day_4_Forecast },
      { day: 'Day 5', max: forecast.Day_5_Max_Temp, min: forecast.Day_5_Min_temp, text: forecast.Day_5_Forecast },
      { day: 'Day 6', max: forecast.Day_6_Max_Temp, min: forecast.Day_6_Min_temp, text: forecast.Day_6_Forecast },
      { day: 'Day 7', max: forecast.Day_7_Max_Temp, min: forecast.Day_7_Min_temp, text: forecast.Day_7_Forecast },
    ].filter((d) => d.max !== undefined || d.min !== undefined || d.text);
  }, [forecast]);

  const rainfallRows = useMemo(() => {
    if (!rainfall) return [];
    return [
      {
        period: 'Daily',
        dateRange: rainfall.Date || '--',
        actual: rainfall['Daily Actual'],
        normal: rainfall['Daily Normal'],
        departure: rainfall['Daily Departure Per'],
        category: describeImdRainfallCategory(rainfall['Daily Category']),
      },
      {
        period: 'Weekly',
        dateRange: cleanImdPeriodText(rainfall['Week Date']),
        actual: rainfall['Weekly Actual'],
        normal: rainfall['Weekly Normal'],
        departure: rainfall['Weekly Departure Per'],
        category: describeImdRainfallCategory(rainfall['Weekly Category']),
      },
      {
        period: 'Monthly',
        dateRange: cleanImdPeriodText(rainfall['Monthly Date']),
        actual: rainfall['Monthly Acutual'] ?? rainfall['Monthly Actual'],
        normal: rainfall['Monthly Normal'],
        departure: rainfall['Monthly Departure Per'],
        category: describeImdRainfallCategory(rainfall['Monthly Category']),
      },
      {
        period: 'Cumulative',
        dateRange: rainfall['Cumulative Date'] ? `Since ${rainfall['Cumulative Date']}` : '--',
        actual: rainfall['Cumulative Actual'],
        normal: rainfall['Cumulative Normal'],
        departure: rainfall['Cumulative Departue Per'] ?? rainfall['Cumulative Departure Per'],
        category: describeImdRainfallCategory(rainfall['Cumulative Category']),
      },
    ];
  }, [rainfall]);

  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm border border-[#DFEBDE] space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#113E2E] text-[#E5B54F] flex items-center justify-center shrink-0 shadow-xs">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-[#F0F7F2] border border-[#cbe1d2] text-[10px] font-extrabold uppercase tracking-wider text-[#113E2E]">
                IMD Official Bureau Feed
              </span>
              {weatherSource?.current && (
                <span
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${
                    weatherSource.current === 'IMD' && weatherSource.forecast === 'IMD'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {weatherSource.current === 'IMD' && weatherSource.forecast === 'IMD'
                    ? 'Primary: IMD Active'
                    : weatherSource.current === 'IMD' || weatherSource.forecast === 'IMD'
                      ? 'Hybrid: IMD + Fallback'
                      : 'Fallback Weather Active'}
                </span>
              )}
              {(current?.Station || forecast?.Station_Name) && (
                <span className="text-xs font-semibold text-slate-600 notranslate" translate="no">
                  Station: {current?.Station || forecast?.Station_Name}
                  {currentStationId || current?.['Station Id'] || forecastStationId
                    ? ` (#${current?.['Station Id'] || currentStationId || forecastStationId})`
                    : ''}
                </span>
              )}
              {(warnings?.District || rainfall?.District || districtId) && (
                <span className="text-xs font-semibold text-[#175638] notranslate" translate="no">
                  · District: {warnings?.District || rainfall?.District || `#${districtId}`}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-1">
              <span>India Meteorological Department (IMD) Telemetry</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <span>
                Official station observations, 7-day city forecast, 5-day district warnings, and rainfall departures for{' '}
              </span>
              <strong className="text-slate-700">{locationLabel}</strong>
            </p>
          </div>
        </div>

        {isAuthenticated && (
          <div className="flex flex-wrap items-center gap-2.5">
            {sortedStations.length > 1 && (
              <select
                aria-label="Select IMD Observation Station"
                value={current?.['Station Id'] || ''}
                onChange={(e) => onSelectStation(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#d5e7db] bg-[#F8FAF7] text-xs font-semibold text-[#113E2E] focus:outline-none focus:border-[#113E2E] max-w-[220px] truncate cursor-pointer notranslate"
                translate="no"
              >
                {sortedStations.map((st) => (
                  <option key={st['Station Id']} value={st['Station Id']}>
                    {st.Station} (#{st['Station Id']})
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#113E2E] hover:bg-[#0a291f] disabled:opacity-60 text-white text-xs font-bold shadow-xs transition cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#E5B54F] ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Syncing IMD...' : 'Refresh IMD'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Unauthenticated Gate: Prevents 401 API calls when guest */}
      {!isAuthenticated ? (
        <div className="rounded-2xl bg-[#F8FAF7] border border-[#d5e7db] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-[#d5e7db] flex items-center justify-center text-[#113E2E] shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#113E2E]">
                Sign in to load official IMD Bureau data
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                IMD station telemetry, district color alerts, 7-day forecast, and rainfall departure endpoints require an authenticated farmer session.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenAuth}
            className="px-4 py-2.5 rounded-xl bg-[#113E2E] hover:bg-[#0a291f] text-white text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sign In / Verify OTP
          </button>
        </div>
      ) : (
        <>
          {/* Section Navigation Tabs */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'observation', label: 'Current Station', icon: Thermometer },
                { id: 'forecast', label: '7-Day IMD Forecast', icon: Compass },
                { id: 'warnings', label: '5-Day District Warnings', icon: AlertTriangle },
                { id: 'rainfall', label: 'Rainfall Departure', icon: CloudRain },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    isActive
                      ? 'bg-[#113E2E] text-white border-[#113E2E] shadow-xs'
                      : 'bg-[#F8FAF7] text-slate-700 border-[#DFEBDE] hover:bg-[#F0F7F2] hover:text-[#113E2E]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#E5B54F]' : 'text-[#175638]'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs font-medium text-amber-900">
              {error}
            </div>
          )}

          {/* Tab 1: Current Station Observation */}
          {activeTab === 'observation' && (
            <div className="space-y-4">
              {current ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F0F7F2] border border-[#cbe1d2] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="text-xs font-bold text-[#175638] uppercase tracking-wider">
                          {current.Station} · ID #{current['Station Id']}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5 notranslate" translate="no">
                          Observed: {current['Date of Observation'] || '--'} ·{' '}
                          {current.Time ? `${current.Time}:00 hrs IST` : '--'} ·{' '}
                          {current.WEATHER_MESSAGE || 'Normal conditions'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2 notranslate" translate="no">
                      <span className="text-2xl font-extrabold text-[#113E2E] tabular-nums">
                        {formatFieldVal(current.Temperature, '°C')}
                      </span>
                      <span className="text-xs text-slate-600">
                        Feels {formatFieldVal(current['Feel Like'], '°C')}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-slate-500">
                        <Droplets className="w-3.5 h-3.5 text-teal-700" />
                        <span>Humidity</span>
                      </div>
                      <div className="text-lg font-bold text-slate-900 mt-1 tabular-nums notranslate" translate="no">
                        {formatFieldVal(current.Humidity, '%')}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-slate-500">
                        <Wind className="w-3.5 h-3.5 text-blue-600" />
                        <span>Wind</span>
                      </div>
                      <div className="text-lg font-bold text-slate-900 mt-1 tabular-nums notranslate" translate="no">
                        {formatFieldVal(current['Wind Speed KMPH'], ' km/h')}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 notranslate" translate="no">
                        Dir: {formatFieldVal(current['Wind Direction'], '°')}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-slate-500">
                        <Gauge className="w-3.5 h-3.5 text-emerald-700" />
                        <span>MSL Pressure</span>
                      </div>
                      <div className="text-lg font-bold text-slate-900 mt-1 tabular-nums notranslate" translate="no">
                        {formatFieldVal(current['Mean Sea Level Pressure'], ' hPa')}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-slate-500">
                        <CloudRain className="w-3.5 h-3.5 text-sky-600" />
                        <span>24h Rainfall</span>
                      </div>
                      <div className="text-lg font-bold text-slate-900 mt-1 tabular-nums notranslate" translate="no">
                        {formatFieldVal(current['Last 24 hrs Rainfall'], ' mm')}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-slate-500">
                        <Sunrise className="w-3.5 h-3.5 text-amber-600" />
                        <span>Sunrise / Set</span>
                      </div>
                      <div className="text-xs font-bold text-slate-900 mt-1.5 tabular-nums notranslate" translate="no">
                        {formatFieldVal(current.Sunrise)} / {formatFieldVal(current.Sunset)}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums notranslate" translate="no">
                        Nebulosity: {formatFieldVal(current.Nebulosity, ' okta')}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-slate-500">
                        <Sunset className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Moonrise / Set</span>
                      </div>
                      <div className="text-xs font-bold text-slate-900 mt-1.5 tabular-nums notranslate" translate="no">
                        {formatFieldVal(current.Moonrise)} / {formatFieldVal(current.Moonset)}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-5 text-xs text-slate-600">
                  {loading
                    ? 'Fetching IMD station observation...'
                    : sectionErrors.current || 'No IMD current observation available for this coordinate.'}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: 7-Day IMD Forecast */}
          {activeTab === 'forecast' && (
            <div className="space-y-4">
              {forecast ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <span className="text-[11px] font-bold uppercase text-slate-500 block">
                        Today Min / Prev Max
                      </span>
                      <span className="text-base font-bold text-slate-900 tabular-nums mt-1 block notranslate" translate="no">
                        {formatFieldVal(forecast.Today_Min_temp, '°C')} /{' '}
                        {formatFieldVal(forecast.Previous_Day_Max_temp, '°C')}
                      </span>
                    </div>

                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <span className="text-[11px] font-bold uppercase text-slate-500 block">
                        RH (08:30 / 17:30)
                      </span>
                      <span className="text-base font-bold text-slate-900 tabular-nums mt-1 block notranslate" translate="no">
                        {formatFieldVal(forecast.Relative_Humidity_at_0830, '%')} /{' '}
                        {formatFieldVal(
                          forecast.Relative_Humidity_at_1730 ??
                            forecast.Previous_Day_Relative_Humidity_at_1730,
                          '%'
                        )}
                      </span>
                    </div>

                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <span className="text-[11px] font-bold uppercase text-slate-500 block">
                        Past 24h Rain
                      </span>
                      <span className="text-base font-bold text-slate-900 tabular-nums mt-1 block notranslate" translate="no">
                        {formatFieldVal(forecast.Past_24_hrs_Rainfall)}
                      </span>
                    </div>

                    <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5">
                      <span className="text-[11px] font-bold uppercase text-slate-500 block">
                        IMD Station
                      </span>
                      <span className="text-sm font-bold text-[#113E2E] mt-1 block truncate notranslate" translate="no">
                        {forecast.Station_Name || '--'} ({forecast.Date || '--'})
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
                    {forecastDays.map((item) => (
                      <div
                        key={item.day}
                        className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-3.5 flex flex-col justify-between gap-2"
                      >
                        <div className="text-xs font-bold text-[#113E2E]">{item.day}</div>
                        <div className="text-sm font-extrabold text-slate-900 tabular-nums notranslate" translate="no">
                          {formatFieldVal(item.max, '°')} / {formatFieldVal(item.min, '°')}
                        </div>
                        <p className="text-xs text-slate-600 leading-snug">
                          {item.text || 'Forecast pending'}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-5 text-xs text-slate-600">
                  {loading
                    ? 'Fetching IMD 7-day station forecast...'
                    : sectionErrors.forecast || 'No IMD forecast available for this coordinate.'}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: 5-Day District Warnings */}
          {activeTab === 'warnings' && (
            <div className="space-y-3">
              {warnings ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="font-bold text-[#113E2E] inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#175638]" />
                      <span className="notranslate" translate="no">
                        District: {warnings.District || `--`} (ID #{warnings.Obj_id || districtId || '--'})
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 notranslate" translate="no">
                      Updated: {warnings.updated_at || warnings.Date || '--'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {warningDays.map((entry) => (
                      <div
                        key={entry.day}
                        className={`rounded-xl border p-3.5 space-y-1.5 ${entry.meta.badgeCls}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold">{entry.day}</span>
                          <span className={`w-2.5 h-2.5 rounded-full ${entry.meta.dotCls}`} />
                        </div>
                        <div className="text-xs font-extrabold">{entry.meta.label}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-5 text-xs text-slate-600">
                  {loading
                    ? 'Fetching IMD district warnings...'
                    : sectionErrors.warnings || 'No IMD district warnings mapped for this location.'}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: District Rainfall Departure */}
          {activeTab === 'rainfall' && (
            <div className="space-y-3">
              {rainfall ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="font-bold text-[#113E2E] notranslate" translate="no">
                      {rainfall.District || '--'}
                      {rainfall.State ? `, ${rainfall.State}` : ''} (District #{rainfall.OBJ_ID || districtId || '--'})
                    </span>
                    <span className="text-[11px] text-slate-500 notranslate" translate="no">
                      Bulletin Date: {rainfall.Date || '--'}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                          <th className="pb-2.5">Period</th>
                          <th className="pb-2.5">Window</th>
                          <th className="pb-2.5">Actual (mm)</th>
                          <th className="pb-2.5">Normal (mm)</th>
                          <th className="pb-2.5">Departure</th>
                          <th className="pb-2.5">Category</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rainfallRows.map((row) => (
                          <tr key={row.period}>
                            <td className="py-3 font-bold text-slate-900">{row.period}</td>
                            <td className="py-3 text-slate-600 notranslate" translate="no">
                              {row.dateRange}
                            </td>
                            <td className="py-3 font-bold text-[#113E2E] tabular-nums notranslate" translate="no">
                              {formatFieldVal(row.actual, ' mm')}
                            </td>
                            <td className="py-3 text-slate-700 tabular-nums notranslate" translate="no">
                              {formatFieldVal(row.normal, ' mm')}
                            </td>
                            <td className="py-3 font-semibold text-slate-800 tabular-nums notranslate" translate="no">
                              {formatFieldVal(row.departure)}
                            </td>
                            <td className="py-3">
                              <span
                                className={`inline-flex px-2.5 py-0.5 rounded-md border text-[11px] font-bold ${row.category.badgeCls}`}
                              >
                                {row.category.label}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="rounded-xl bg-[#F8FAF7] border border-[#DFEBDE] p-5 text-xs text-slate-600">
                  {loading
                    ? 'Fetching IMD district rainfall departure...'
                    : sectionErrors.rainfall || 'No IMD rainfall departure data mapped for this location.'}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
});
