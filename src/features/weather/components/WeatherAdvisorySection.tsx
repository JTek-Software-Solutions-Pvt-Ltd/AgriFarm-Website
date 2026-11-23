/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, useMemo, useState } from 'react';
import {
  ActiveTab,
  FarmerActionPlanItem,
  WeatherAdvisoryAlert,
  WeatherAdvisoryResponse,
} from '../../../shared/types';
import {
  CROP_STAGE_OPTIONS,
  formatAdvisoryTimestamp,
} from '../services/weatherApi';

interface WeatherAdvisorySectionProps {
  advisory: WeatherAdvisoryResponse | null;
  loading: boolean;
  error: string | null;
  cropStage: string;
  locationLabel: string;
  onChangeCropStage: (stage: string) => void;
  onRefresh: () => void;
  onNavigateTab: (tab: ActiveTab) => void;
}

type AdvisorySectionTab = 'plan' | 'alerts' | 'guidance' | 'crop' | 'quality';
type PlanWindowTab = 'immediate' | 'next_24_hours' | 'next_3_7_days';

function humanizeToken(raw?: string | null): string {
  if (!raw) return 'Not available';
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function getSeverityMeta(severity?: string): {
  label: string;
  textCls: string;
  surfaceCls: string;
} {
  const norm = (severity || '').toUpperCase();
  if (norm === 'HIGH' || norm === 'CRITICAL') {
    return {
      label: 'High Severity',
      textCls: 'text-red-800',
      surfaceCls: 'bg-red-50',
    };
  }
  if (norm === 'MEDIUM' || norm === 'MODERATE') {
    return {
      label: 'Medium Severity',
      textCls: 'text-amber-800',
      surfaceCls: 'bg-amber-50',
    };
  }
  return {
    label: 'Low Severity',
    textCls: 'text-[#175638]',
    surfaceCls: 'bg-[#F0F7F2]',
  };
}

function getPriorityMeta(priority?: string): {
  label: string;
  textCls: string;
} {
  const norm = (priority || '').toLowerCase();
  if (norm === 'high') {
    return { label: 'High Priority', textCls: 'text-red-700' };
  }
  if (norm === 'medium') {
    return { label: 'Medium Priority', textCls: 'text-amber-700' };
  }
  return { label: 'Routine / Low', textCls: 'text-[#175638]' };
}

function renderCropEntryText(
  entry:
    | string
    | { crop_name?: string; name?: string; reason?: string; note?: string; season?: string }
): { title: string; subtitle: string } {
  if (typeof entry === 'string') {
    return { title: entry, subtitle: '' };
  }
  const title = entry.crop_name || entry.name || 'Recommended Crop';
  const subtitle = [entry.season, entry.reason || entry.note].filter(Boolean).join(' · ');
  return { title, subtitle };
}

export const WeatherAdvisorySection: React.FC<WeatherAdvisorySectionProps> = memo(({
  advisory,
  loading,
  error,
  cropStage,
  locationLabel,
  onChangeCropStage,
  onRefresh,
  onNavigateTab,
}) => {
  const [activeTab, setActiveTab] = useState<AdvisorySectionTab>('plan');
  const [planWindow, setPlanWindow] = useState<PlanWindowTab>('immediate');

  const tz = advisory?.weather?.timezone;
  const alerts: WeatherAdvisoryAlert[] = advisory?.advisory?.weather_alerts || [];
  const immediatePlan: FarmerActionPlanItem[] = advisory?.farmer_action_plan?.immediate || [];
  const next24Plan: FarmerActionPlanItem[] = advisory?.farmer_action_plan?.next_24_hours || [];
  const next3To7Plan: FarmerActionPlanItem[] = advisory?.farmer_action_plan?.next_3_7_days || [];

  const activePlanItems = useMemo(() => {
    if (planWindow === 'immediate') return immediatePlan;
    if (planWindow === 'next_24_hours') return next24Plan;
    return next3To7Plan;
  }, [planWindow, immediatePlan, next24Plan, next3To7Plan]);

  const cropSpecificActions =
    advisory?.advisory?.crop_specific_recommendations?.weather_based_actions || [];
  const verifiedAgronomic =
    advisory?.advisory?.crop_specific_recommendations?.verified_agronomic_recommendations || [];
  const cropIdentity =
    advisory?.advisory?.crop_identity ||
    advisory?.advisory?.crop_specific_recommendations?.crop_identity;
  const suitableCrops = advisory?.advisory?.suitable_crops || [];
  const alternativeCrops = advisory?.advisory?.alternative_crops || [];

  const cropDisplayName =
    advisory?.crop_information?.crop_name ||
    advisory?.advisory?.crop_name ||
    cropIdentity?.common_name ||
    null;

  const advisoryLocationDisplay =
    [
      advisory?.location?.village,
      advisory?.location?.district,
      advisory?.location?.state,
    ]
      .filter(Boolean)
      .join(', ') ||
    advisory?.location?.label ||
    locationLabel;

  return (
    <section
      aria-labelledby="ai-weather-advisory-heading"
      className="bg-white rounded-2xl border border-[#DFEBDE] shadow-sm overflow-hidden"
    >
      {/* Header & Interactive Stage Controls */}
      <div className="p-6 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>AI Agronomic Weather Advisory</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-[#113E2E]">{advisoryLocationDisplay}</span>
            {advisory?.advisory?.current_season && (
              <>
                <span aria-hidden="true">·</span>
                <span>{advisory.advisory.current_season}</span>
              </>
            )}
            {advisory?.farmer_type && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {cropDisplayName
                    ? `${cropDisplayName}${
                        advisory.crop_information?.scientific_name
                          ? ` (${advisory.crop_information.scientific_name})`
                          : ''
                      }`
                    : 'No crop assigned in profile'}
                </span>
              </>
            )}
          </div>

          <h2
            id="ai-weather-advisory-heading"
            className="text-lg font-bold text-slate-900 mt-1"
          >
            Field Advisory &amp; Action Plan
          </h2>

          <p className="text-xs text-slate-600 mt-1 leading-relaxed max-w-3xl">
            {advisory?.advisory?.weather_summary ||
              'Real-time weather alerts, immediate field work windows, and stage-aware crop guidance synchronized with your farm coordinates.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold whitespace-nowrap">Crop Stage:</span>
            <select
              value={cropStage}
              onChange={(e) => onChangeCropStage(e.target.value)}
              disabled={loading}
              aria-label="Select crop growth stage for weather advisory"
              className="px-3 py-2 rounded-xl border border-[#DFEBDE] bg-[#F8FAF7] text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#113E2E] cursor-pointer disabled:opacity-60"
            >
              {CROP_STAGE_OPTIONS.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-[#113E2E] hover:bg-[#0a291f] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <span
              className={`material-symbols-outlined notranslate text-sm ${
                loading ? 'animate-spin' : ''
              }`}
              translate="no"
            >
              sync
            </span>
            <span>{loading ? 'Updating Advisory...' : 'Refresh Advisory'}</span>
          </button>
        </div>
      </div>

      {/* Loading Skeleton (Initial Load) */}
      {loading && !advisory && (
        <div className="p-6 space-y-5" aria-busy="true">
          <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
            <span className="material-symbols-outlined notranslate text-base text-[#175638] animate-spin" translate="no">
              progress_activity
            </span>
            <span>
              Generating AI agronomic weather advisory for {advisoryLocationDisplay} ({cropStage})...
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
          </div>
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="px-6 py-4 bg-red-50/70 border-b border-red-100 flex flex-wrap items-center justify-between gap-3 text-xs text-red-800"
        >
          <div className="flex items-center gap-2 font-medium">
            <span className="material-symbols-outlined notranslate text-base text-red-700" translate="no">
              error
            </span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="px-3.5 py-1.5 rounded-lg bg-white border border-red-200 text-red-800 font-semibold hover:bg-red-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Retry Advisory
          </button>
        </div>
      )}

      {/* Populated Advisory Content */}
      {advisory && (
        <div>
          {/* Summary & Refresh Cadence Bar */}
          <div className="px-6 py-4 bg-[#F8FAF7] border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <p className="text-xs text-slate-700 leading-relaxed max-w-4xl">
              <span className="font-semibold text-slate-900">Advisory Summary: </span>
              {advisory.advisory.summary}
            </p>
            <div className="text-xs text-slate-500 tabular-nums shrink-0 whitespace-nowrap notranslate" translate="no">
              Updated {formatAdvisoryTimestamp(advisory.last_updated, tz)} · Next{' '}
              {formatAdvisoryTimestamp(advisory.next_update, tz)}
            </div>
          </div>

          {/* Segmented Section Tabs */}
          <div className="px-6 pt-4 pb-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('plan')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'plan'
                    ? 'bg-white text-[#113E2E] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Action Plan ({immediatePlan.length + next24Plan.length + next3To7Plan.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('alerts')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'alerts'
                    ? 'bg-white text-[#113E2E] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Weather Alerts ({alerts.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('guidance')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'guidance'
                    ? 'bg-white text-[#113E2E] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Agronomic Guidance
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('crop')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'crop'
                    ? 'bg-white text-[#113E2E] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Crop &amp; Suitability
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('quality')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'quality'
                    ? 'bg-white text-[#113E2E] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Forecast &amp; Data Quality
              </button>
            </div>

            {advisory.advisory.upcoming_season && (
              <div className="text-xs text-slate-500">
                <span>Season: {advisory.advisory.current_season}</span>
                <span aria-hidden="true"> · </span>
                <span>Next: {advisory.advisory.upcoming_season}</span>
              </div>
            )}
          </div>

          {/* Tab 1: Farmer Action Plan */}
          {activeTab === 'plan' && (
            <div className="p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-[#F8FAF7] border border-[#DFEBDE] rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPlanWindow('immediate')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      planWindow === 'immediate'
                        ? 'bg-[#113E2E] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Immediate ({immediatePlan.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlanWindow('next_24_hours')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      planWindow === 'next_24_hours'
                        ? 'bg-[#113E2E] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Next 24 Hours ({next24Plan.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlanWindow('next_3_7_days')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      planWindow === 'next_3_7_days'
                        ? 'bg-[#113E2E] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Next 3–7 Days ({next3To7Plan.length})
                  </button>
                </div>

                {alerts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('alerts')}
                    className="text-xs font-semibold text-[#175638] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Inspect {alerts.length} active weather {alerts.length === 1 ? 'alert' : 'alerts'} →
                  </button>
                )}
              </div>

              {activePlanItems.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {activePlanItems.map((item, idx) => {
                    const prio = getPriorityMeta(item.priority);
                    return (
                      <div key={`${planWindow}-${idx}`} className="py-4 first:pt-1 last:pb-1 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`font-bold ${prio.textCls}`}>{prio.label}</span>
                            {item.alert_type && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="font-semibold text-slate-700">{item.alert_type}</span>
                              </>
                            )}
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="text-slate-500">{humanizeToken(item.source_type)}</span>
                          </div>
                          {item.expected_time && (
                            <span className="text-slate-500 font-mono tabular-nums notranslate" translate="no">
                              {item.expected_time}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-slate-900 leading-snug">
                          {item.action}
                        </p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {item.reason}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-4">
                  No urgent field actions triggered in this horizon. Continue routine scouting and monitor daily updates.
                </p>
              )}
            </div>
          )}

          {/* Tab 2: Weather Alerts */}
          {activeTab === 'alerts' && (
            <div className="p-6">
              {alerts.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {alerts.map((alert, idx) => {
                    const sev = getSeverityMeta(alert.severity);
                    return (
                      <div key={`${alert.type}-${idx}`} className="py-5 first:pt-0 last:pb-0 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span
                              className={`px-2 py-0.5 rounded-md text-xs font-bold ${sev.surfaceCls} ${sev.textCls}`}
                            >
                              {sev.label}
                            </span>
                            <h3 className="text-sm font-bold text-slate-900">{alert.type}</h3>
                          </div>
                          <span className="text-xs text-slate-500 font-mono tabular-nums notranslate" translate="no">
                            {alert.expected_time}
                          </span>
                        </div>

                        <p className="text-xs text-slate-700 leading-relaxed">
                          {alert.description}
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 text-xs">
                          <div>
                            <span className="font-semibold text-slate-800 block">Potential Crop Impact</span>
                            <p className="text-slate-600 mt-0.5 leading-relaxed">
                              {alert.potential_crop_impact}
                            </p>
                          </div>
                          <div>
                            <span className="font-semibold text-[#113E2E] block">Recommended Farmer Action</span>
                            <p className="text-slate-700 mt-0.5 leading-relaxed">
                              {alert.farmer_action}
                            </p>
                          </div>
                        </div>

                        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 pt-1 tabular-nums">
                          <span>
                            {alert.official_warning
                              ? 'Official warning'
                              : alert.forecast_based
                                ? 'Forecast-based watch'
                                : 'Observed station reading'}
                          </span>
                          {alert.windows && alert.windows.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                Covers {alert.windows.length}{' '}
                                {alert.windows.length === 1 ? 'window' : 'windows'}
                              </span>
                            </>
                          )}
                          {alert.source_types && alert.source_types.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{alert.source_types.map(humanizeToken).join(', ')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-6 text-xs text-slate-600">
                  No weather hazard alerts are currently active for {advisoryLocationDisplay}.
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Agronomic Guidance */}
          {activeTab === 'guidance' && (
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <div className="space-y-2 pb-4 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900">Crop Protection</h3>
                  <ul className="space-y-2 text-xs text-slate-700 leading-relaxed">
                    {advisory.advisory.crop_protection.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2 pb-4 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900">Irrigation Recommendations</h3>
                  <ul className="space-y-2 text-xs text-slate-700 leading-relaxed">
                    {advisory.advisory.irrigation_recommendations.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2 pb-4 border-b border-slate-100 md:border-b-0 md:pb-0">
                  <h3 className="text-sm font-bold text-slate-900">Crop Care Recommendations</h3>
                  <ul className="space-y-2 text-xs text-slate-700 leading-relaxed">
                    {advisory.advisory.crop_care_recommendations.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-900">Preventive Measures</h3>
                  <ul className="space-y-2 text-xs text-slate-700 leading-relaxed">
                    {advisory.advisory.preventive_measures.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {cropSpecificActions.length > 0 && (
                <div className="pt-5 border-t border-slate-100 space-y-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Weather-Linked Actions{cropDisplayName ? ` for ${cropDisplayName}` : ''}
                    </h3>
                    {advisory.advisory.crop_specific_recommendations?.note && (
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        {advisory.advisory.crop_specific_recommendations.note}
                      </p>
                    )}
                  </div>
                  <div className="divide-y divide-slate-100">
                    {cropSpecificActions.map((item, idx) => {
                      const prio = getPriorityMeta(item.priority);
                      return (
                        <div key={`${item.trigger}-${idx}`} className="py-3 first:pt-1 last:pb-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={`font-bold ${prio.textCls}`}>{prio.label}</span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="text-slate-600">{humanizeToken(item.trigger)}</span>
                            {item.observed_value && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="font-mono text-slate-700 tabular-nums notranslate" translate="no">
                                  {item.observed_value}
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-xs font-medium text-slate-800 leading-relaxed">
                            {item.action}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {verifiedAgronomic.length > 0 && (
                <div className="pt-5 border-t border-slate-100 space-y-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Verified Agronomic Package Guidance
                  </h3>
                  <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed">
                    {verifiedAgronomic.map((rec, idx) => (
                      <li key={idx}>
                        {typeof rec === 'string' ? rec : JSON.stringify(rec)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {advisory.advisory.season_note && (
                <p className="pt-4 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
                  {advisory.advisory.season_note}
                </p>
              )}
            </div>
          )}

          {/* Tab 4: Crop Identity & Suitability */}
          {activeTab === 'crop' && (
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-5 border-b border-slate-100">
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-900">Crop &amp; Field Context</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Registered Crop</dt>
                      <dd className="font-semibold text-slate-900 mt-0.5">
                        {cropDisplayName || 'Not selected'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Scientific Name</dt>
                      <dd className="font-medium text-slate-800 italic mt-0.5">
                        {advisory.crop_information.scientific_name ||
                          cropIdentity?.scientific_name ||
                          'Not resolved'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Growth Stage</dt>
                      <dd className="font-semibold text-slate-900 mt-0.5">
                        {advisory.crop_information.growth_stage || cropStage}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Identity Status</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {humanizeToken(advisory.crop_information.crop_identity_status)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Soil Type / pH</dt>
                      <dd className="font-medium text-slate-800 mt-0.5 tabular-nums">
                        {advisory.crop_information.soil_type || 'Not supplied'}
                        {advisory.crop_information.soil_ph != null
                          ? ` · pH ${advisory.crop_information.soil_ph}`
                          : ''}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Database Crop Season</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {advisory.crop_information.database_crop_season ||
                          advisory.crop_information.current_season}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="space-y-2.5">
                  <h3 className="text-sm font-bold text-slate-900">Crop Identity &amp; Purpose Verification</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {cropIdentity?.note ||
                      advisory.advisory.crop_recommendation_note ||
                      'Select a crop in your farmer profile to enable crop-specific monitoring and alerts.'}
                  </p>

                  {cropIdentity?.evidence && cropIdentity.evidence.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-xs font-semibold text-slate-700 block">
                        Authoritative References
                      </span>
                      <ul className="space-y-1 text-xs text-slate-600">
                        {cropIdentity.evidence.map((ev, idx) => (
                          <li key={idx}>
                            {ev.url ? (
                              <a
                                href={ev.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-[#175638] hover:underline"
                              >
                                {ev.title}
                              </a>
                            ) : (
                              <span className="font-semibold text-slate-800">{ev.title}</span>
                            )}
                            {ev.supports ? ` — ${ev.supports}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!cropDisplayName && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => onNavigateTab('profile')}
                        className="px-4 py-2 rounded-xl bg-[#113E2E] hover:bg-[#0a291f] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Select Primary Crop in Profile
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {(suitableCrops.length > 0 || alternativeCrops.length > 0) ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 mb-2">Suitable Crops</h3>
                    {suitableCrops.length > 0 ? (
                      <ul className="divide-y divide-slate-100 text-xs">
                        {suitableCrops.map((crop, idx) => {
                          const rendered = renderCropEntryText(crop);
                          return (
                            <li key={idx} className="py-2">
                              <span className="font-semibold text-slate-900 block">{rendered.title}</span>
                              {rendered.subtitle && (
                                <span className="text-slate-600">{rendered.subtitle}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No primary suitable crop entries returned.</p>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-slate-900 mb-2">Alternative Crops</h3>
                    {alternativeCrops.length > 0 ? (
                      <ul className="divide-y divide-slate-100 text-xs">
                        {alternativeCrops.map((crop, idx) => {
                          const rendered = renderCropEntryText(crop);
                          return (
                            <li key={idx} className="py-2">
                              <span className="font-semibold text-slate-900 block">{rendered.title}</span>
                              {rendered.subtitle && (
                                <span className="text-slate-600">{rendered.subtitle}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No alternative crop entries returned.</p>
                    )}
                  </div>
                </div>
              ) : (
                advisory.advisory.crop_recommendation_note && (
                  <div className="text-xs text-slate-600 leading-relaxed">
                    <span className="font-semibold text-slate-800">
                      {humanizeToken(advisory.advisory.crop_recommendation_status)}:{' '}
                    </span>
                    {advisory.advisory.crop_recommendation_note}
                  </div>
                )
              )}
            </div>
          )}

          {/* Tab 5: Forecast Snapshot & Data Quality */}
          {activeTab === 'quality' && (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-5 border-b border-slate-100 text-xs">
                <div>
                  <span className="text-slate-500 block">Current / Apparent</span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums notranslate mt-0.5 block" translate="no">
                    {advisory.weather.temperature_forecast.current_c}°C /{' '}
                    {advisory.weather.temperature_forecast.apparent_c}°C
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Today Range</span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums notranslate mt-0.5 block" translate="no">
                    {advisory.weather.temperature_forecast.today_min_c}° –{' '}
                    {advisory.weather.temperature_forecast.today_max_c}°C
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Next 24h Range</span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums notranslate mt-0.5 block" translate="no">
                    {advisory.weather.temperature_forecast.next_24h_min_c}° –{' '}
                    {advisory.weather.temperature_forecast.next_24h_max_c}°C
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Tomorrow Range</span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums notranslate mt-0.5 block" translate="no">
                    {advisory.weather.temperature_forecast.tomorrow_min_c}° –{' '}
                    {advisory.weather.temperature_forecast.tomorrow_max_c}°C
                  </span>
                </div>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <dt className="text-slate-500">Confidence Level</dt>
                  <dd className="font-semibold text-slate-900 mt-0.5">
                    {humanizeToken(advisory.data_quality.confidence)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Weather Station Timestamp</dt>
                  <dd className="font-mono text-slate-800 tabular-nums mt-0.5 notranslate" translate="no">
                    {formatAdvisoryTimestamp(advisory.data_quality.weather_data_timestamp, tz)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Soil Telemetry Timestamp</dt>
                  <dd className="font-medium text-slate-800 tabular-nums mt-0.5">
                    {advisory.data_quality.soil_data_timestamp
                      ? formatAdvisoryTimestamp(advisory.data_quality.soil_data_timestamp, tz)
                      : 'Not supplied'}
                  </dd>
                </div>
              </dl>

              {advisory.data_quality.missing_information?.length > 0 && (
                <div className="text-xs text-slate-600 pt-2 border-t border-slate-100">
                  <span className="font-semibold text-slate-800">Missing Field Inputs: </span>
                  {advisory.data_quality.missing_information.map(humanizeToken).join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Quiet Data Quality Footer */}
          <div className="px-6 py-3 bg-[#F8FAF7] border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
            <div>
              <span>Confidence: {humanizeToken(advisory.data_quality.confidence)}</span>
              {advisory.data_quality.missing_information?.length > 0 && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>
                    Missing: {advisory.data_quality.missing_information.map(humanizeToken).join(', ')}
                  </span>
                </>
              )}
            </div>
            <div className="notranslate" translate="no">
              Timezone: {advisory.weather.timezone} · Language: {advisory.language.toUpperCase()}
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
