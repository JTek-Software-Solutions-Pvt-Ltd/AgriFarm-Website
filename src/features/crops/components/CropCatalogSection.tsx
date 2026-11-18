/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, RefreshCw, Search, Sprout } from 'lucide-react';
import { ActiveTab } from '../../../shared/types';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import {
  fetchCropList,
  selectAuthUser,
  selectCropOptionsUi,
  selectIsAuthenticated,
} from '../../auth';

interface CropCatalogSectionProps {
  onNavigateTab?: (tab: ActiveTab) => void;
  initialLimit?: number;
}

type AlphaRange = 'all' | 'a-d' | 'e-l' | 'm-p' | 'q-z';

const ALPHA_FILTERS: { id: AlphaRange; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'a-d', label: 'A–D' },
  { id: 'e-l', label: 'E–L' },
  { id: 'm-p', label: 'M–P' },
  { id: 'q-z', label: 'Q–Z' },
];

function matchesAlphaRange(name: string, range: AlphaRange): boolean {
  if (range === 'all') return true;
  const ch = name.trim().charAt(0).toUpperCase();
  if (!ch) return false;
  switch (range) {
    case 'a-d':
      return ch >= 'A' && ch <= 'D';
    case 'e-l':
      return ch >= 'E' && ch <= 'L';
    case 'm-p':
      return ch >= 'M' && ch <= 'P';
    case 'q-z':
      return ch >= 'Q' && ch <= 'Z';
  }
}

export const CropCatalogSection: React.FC<CropCatalogSectionProps> = memo(
  ({ onNavigateTab, initialLimit = 18 }) => {
    const dispatch = useAppDispatch();
    const isAuthenticated = useAppSelector(selectIsAuthenticated);
    const user = useAppSelector(selectAuthUser);
    const { crops, cropsLoading, cropsLoaded, cropsError } =
      useAppSelector(selectCropOptionsUi);

    const [query, setQuery] = useState('');
    const [alphaRange, setAlphaRange] = useState<AlphaRange>('all');
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
      if (!cropsLoaded && !cropsLoading && !cropsError) {
        dispatch(fetchCropList());
      }
    }, [dispatch, cropsLoaded, cropsLoading, cropsError]);

    const filteredCrops = useMemo(() => {
      const q = query.trim().toLowerCase();
      const matched = crops.filter((crop) => {
        if (!matchesAlphaRange(crop.label, alphaRange)) return false;
        if (!q) return true;
        return (
          crop.label.toLowerCase().includes(q) ||
          (crop.category && crop.category.toLowerCase().includes(q)) ||
          (crop.season && crop.season.toLowerCase().includes(q)) ||
          String(crop.id) === q
        );
      });

      if (isAuthenticated && user?.cropId) {
        return [...matched].sort((a, b) => {
          if (a.id === user.cropId && b.id !== user.cropId) return -1;
          if (b.id === user.cropId && a.id !== user.cropId) return 1;
          return 0;
        });
      }

      return matched;
    }, [alphaRange, crops, isAuthenticated, query, user?.cropId]);

    const visibleCrops = useMemo(() => {
      if (expanded || query.trim().length > 0 || alphaRange !== 'all') {
        return filteredCrops;
      }
      return filteredCrops.slice(0, initialLimit);
    }, [alphaRange, expanded, filteredCrops, initialLimit, query]);

    const hasHiddenItems =
      !expanded &&
      query.trim().length === 0 &&
      alphaRange === 'all' &&
      filteredCrops.length > initialLimit;

    return (
      <section className="bg-white rounded-2xl p-5 border border-[#e5ebe7] shadow-xs space-y-4">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#f0f7f2] text-[#175638] flex items-center justify-center shrink-0 mt-0.5">
              <Sprout className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Supported Crops Catalog
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                {cropsLoaded
                  ? `${crops.length} verified crops synced from live commodity directory`
                  : cropsLoading
                    ? 'Loading supported crop directory...'
                    : 'Live commodity & advisory crop directory'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:flex-none">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setExpanded(false);
                }}
                placeholder="Search crop list..."
                aria-label="Search supported crops"
                className="pl-8 pr-3 py-1.5 w-full sm:w-52 rounded-xl border border-[#d5e7db] bg-[#f8faf7] focus:bg-white focus:border-[#113e2e] focus:outline-none text-xs text-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={() => dispatch(fetchCropList({ force: true }))}
              disabled={cropsLoading}
              aria-label="Refresh crop list"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#d5e7db] bg-white hover:bg-[#f0f7f2] disabled:opacity-60 text-xs font-semibold text-[#113e2e] transition cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#175638] ${cropsLoading ? 'animate-spin' : ''}`}
              />
              <span>{cropsLoading ? 'Syncing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Segmented Alphabet Filter */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-100">
          <div className="inline-flex items-center gap-1 p-1 bg-[#f3f6f1] rounded-xl">
            {ALPHA_FILTERS.map((item) => {
              const active = alphaRange === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setAlphaRange(item.id);
                    setExpanded(false);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-[#113e2e] shadow-xs'
                      : 'text-slate-600 hover:text-[#113e2e]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <span className="text-xs text-slate-500 tabular-nums">
            Showing {visibleCrops.length} of {filteredCrops.length} crops
          </span>
        </div>

        {/* Loading State */}
        {cropsLoading && crops.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6">
            {Array.from({ length: 12 }).map((_, idx) => (
              <div
                key={idx}
                className="h-11 border-b border-slate-100 flex items-center justify-between gap-3 animate-pulse"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-3 bg-slate-200 rounded" />
                  <div className="w-32 h-3.5 bg-slate-200 rounded" />
                </div>
                <div className="w-4 h-3 bg-slate-200 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {cropsError && crops.length === 0 && !cropsLoading && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-red-50 border border-red-200 flex flex-wrap items-center justify-between gap-3 text-xs text-red-800"
          >
            <span>{cropsError}</span>
            <button
              type="button"
              onClick={() => dispatch(fetchCropList({ force: true }))}
              className="px-3 py-1.5 rounded-lg bg-white border border-red-200 font-semibold text-red-800 hover:bg-red-100 transition cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty Filter State */}
        {!cropsLoading && crops.length > 0 && filteredCrops.length === 0 && (
          <div className="py-8 text-center space-y-2">
            <p className="text-xs sm:text-sm font-semibold text-slate-700">
              No crops matched &ldquo;{query.trim() || alphaRange.toUpperCase()}&rdquo;.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setAlphaRange('all');
              }}
              className="px-3.5 py-1.5 rounded-lg border border-[#d5e7db] bg-[#f8faf7] hover:bg-[#f0f7f2] text-xs font-semibold text-[#113e2e] transition cursor-pointer"
            >
              Clear filter
            </button>
          </div>
        )}

        {/* Populated Directory Grid */}
        {visibleCrops.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6">
            {visibleCrops.map((crop) => {
              const isPrimary = Boolean(isAuthenticated && user?.cropId === crop.id);
              const metaParts = [crop.category, crop.season].filter(Boolean);
              return (
                <button
                  key={crop.id}
                  type="button"
                  onClick={() => onNavigateTab?.('market-prices')}
                  className={`h-11 px-2 border-b border-slate-100 flex items-center justify-between gap-2 text-left transition rounded-md cursor-pointer group ${
                    isPrimary ? 'bg-[#f0f7f2]' : 'hover:bg-[#f8faf7]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0 w-8">
                      #{String(crop.id).padStart(3, '0')}
                    </span>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-slate-900 truncate block">
                        {crop.label}
                      </span>
                      {metaParts.length > 0 && (
                        <span className="text-[11px] text-slate-500 truncate block">
                          {metaParts.join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isPrimary && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#175638]">
                        <Check className="w-3 h-3" />
                        <span>Primary</span>
                      </span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#175638] transition" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Footer Expand / Collapse & Market Navigation */}
        {filteredCrops.length > 0 && (
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              {hasHiddenItems ? (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="font-semibold text-[#175638] hover:underline cursor-pointer"
                >
                  Show all {filteredCrops.length} crops →
                </button>
              ) : expanded && filteredCrops.length > initialLimit && !query.trim() && alphaRange === 'all' ? (
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="font-semibold text-slate-600 hover:text-[#113e2e] hover:underline cursor-pointer"
                >
                  Show compact view ({initialLimit})
                </button>
              ) : (
                <span className="text-slate-500">
                  Select any crop to inspect live market trends.
                </span>
              )}
            </div>

            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('market-prices')}
                className="font-semibold text-[#175638] hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <span>Open Mandi Prices</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </section>
    );
  }
);
