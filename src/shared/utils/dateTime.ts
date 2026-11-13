/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { CalendarTask } from '../types';

/**
 * React hook returning a live Date synchronized to the minute and on tab focus.
 */
export function useLiveNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const updateNow = () => setNow(new Date());
    const timer = window.setInterval(updateNow, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') updateNow();
    };
    window.addEventListener('focus', updateNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return now;
}

export type GreetingPeriodKey =
  | 'overview.greetingMorning'
  | 'overview.greetingAfternoon'
  | 'overview.greetingEvening'
  | 'overview.greetingNight';

export function getGreetingKey(date: Date = new Date()): GreetingPeriodKey {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'overview.greetingMorning';
  if (hour >= 12 && hour < 17) return 'overview.greetingAfternoon';
  if (hour >= 17 && hour < 21) return 'overview.greetingEvening';
  return 'overview.greetingNight';
}

export function formatFullDisplayDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function formatShortDateOffset(
  daysOffset: number,
  includeYear = true,
  baseDate: Date = new Date()
): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + daysOffset);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

export function formatWeekdayShortDateOffset(
  daysOffset: number,
  baseDate: Date = new Date()
): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + daysOffset);
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

export function formatDateRangeOffset(
  startOffsetDays: number,
  endOffsetDays: number,
  baseDate: Date = new Date()
): string {
  const start = new Date(baseDate);
  start.setDate(start.getDate() + startOffsetDays);
  const end = new Date(baseDate);
  end.setDate(end.getDate() + endOffsetDays);

  const startDay = start.toLocaleDateString('en-IN', { day: '2-digit' });
  const endDay = end.toLocaleDateString('en-IN', { day: '2-digit' });
  const startMonth = start.toLocaleDateString('en-IN', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-IN', { month: 'short' });

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay} – ${endDay}`;
  }
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
}

export function formatLiveClockTime(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatRelativeSyncTime(
  lastFetchedAt?: number | null,
  now: Date = new Date()
): string {
  if (!lastFetchedAt) return `Live • ${formatLiveClockTime(now)}`;
  const diffMin = Math.max(0, Math.floor((now.getTime() - lastFetchedAt) / 60_000));
  if (diffMin < 1) return `Refreshed just now (${formatLiveClockTime(new Date(lastFetchedAt))})`;
  if (diffMin < 60) return `Refreshed ${diffMin}m ago`;
  return `Refreshed ${formatLiveClockTime(new Date(lastFetchedAt))}`;
}

/**
 * Computes active Indian agricultural season from the calendar month.
 */
export function getCurrentAgriSeason(date: Date = new Date()): string {
  const month = date.getMonth(); // 0-indexed (0 = Jan, 10 = Nov)
  const year = date.getFullYear();
  if (month >= 5 && month <= 9) {
    return `Kharif ${year}`;
  }
  if (month >= 10 || month <= 2) {
    return `Rabi ${year}`;
  }
  return `Zaid ${year}`;
}

export function getIsoWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export interface CalendarWeekDay {
  isoDate: string;
  dayName: string;
  dateNum: string;
  monthShort: string;
  isToday: boolean;
  hasTask: boolean;
}

export function getWeekStartMonday(weekOffset = 0, baseDate: Date = new Date()): Date {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const jsDay = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + diffToMonday + weekOffset * 7);
  return d;
}

export function toIsoDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getMonthYearAndWeekLabel(
  weekOffset = 0,
  baseDate: Date = new Date()
): { monthYear: string; weekNumber: number; label: string } {
  const monday = getWeekStartMonday(weekOffset, baseDate);
  const focusDate = new Date(monday);
  focusDate.setDate(monday.getDate() + 3); // Thursday defines the ISO week & dominant month
  const monthYear = focusDate.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
  const weekNumber = getIsoWeekNumber(focusDate);
  return {
    monthYear,
    weekNumber,
    label: `${monthYear} • Week ${weekNumber}`,
  };
}

export function getWeekStripDays(
  weekOffset = 0,
  taskDateKeys?: Set<string>,
  baseDate: Date = new Date()
): CalendarWeekDay[] {
  const todayKey = toIsoDateKey(baseDate);
  const monday = getWeekStartMonday(weekOffset, baseDate);

  return Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + idx);
    const isoDate = toIsoDateKey(d);
    return {
      isoDate,
      dayName: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      dateNum: String(d.getDate()).padStart(2, '0'),
      monthShort: d.toLocaleDateString('en-IN', { month: 'short' }),
      isToday: isoDate === todayKey,
      hasTask: taskDateKeys ? taskDateKeys.has(isoDate) : idx === 1 || idx === 3 || idx === 4 || idx === 5,
    };
  });
}

export function buildDynamicCalendarTasks(baseDate: Date = new Date()): CalendarTask[] {
  const twoDaysStr = formatWeekdayShortDateOffset(2, baseDate);
  const nextWeekStr = formatShortDateOffset(7, false, baseDate);

  return [
    {
      id: 'task-1',
      title: 'Precision Urea & DAP Top-Dressing (Second Split)',
      description:
        'Apply 25 kg Urea + 10 kg DAP per acre (45 DAS vegetative stage). Soil nitrogen saturation is currently 38%. Ideal moisture window before light rain.',
      category: 'fertilizer',
      categoryLabel: 'Fertilizer Application',
      field: 'Field 1 (Basmati Rice - 5.0 Acres)',
      timing: 'Today • 10:00 AM - 01:00 PM',
      dueDateLabel: 'Due Today',
      isCompleted: false,
      actionButtonText: 'Mark as Completed',
      guideButtonText: 'Spreading Guide',
    },
    {
      id: 'task-2',
      title: 'Neem Biopesticide Foliar Spray (Thrips & Mites)',
      description:
        '5ml/L cold-pressed neem formulation to protect early flower buds against thrips and mites during cool morning hours.',
      category: 'pest',
      categoryLabel: 'Crop Protection',
      field: 'Field 2 (Chilli - 3.0 Acres)',
      timing: `Tomorrow (${formatShortDateOffset(1, false, baseDate)}) • 07:30 AM`,
      dueDateLabel: 'Upcoming',
      isCompleted: false,
      actionButtonText: 'Prepare Spray Kit',
      guideButtonText: 'View Safety SOP',
    },
    {
      id: 'task-3',
      title: 'Scheduled Drip Fertigation & Irrigation',
      description:
        'Run automated drip cycle for 2.5 hours to provide 14,000 Litres groundwater and soluble Potassium booster.',
      category: 'irrigation',
      categoryLabel: 'Irrigation Cycle',
      field: 'Field 3 (Maize - 2.5 Acres)',
      timing: `${twoDaysStr} • 06:00 AM`,
      dueDateLabel: 'Scheduled',
      isCompleted: false,
      actionButtonText: 'Review Sensor Trigger',
    },
    {
      id: 'task-4',
      title: 'Gypsum Application at Flowering Stage',
      description:
        'Broadcast 200 kg Gypsum/Acre to enhance pod formation and calcium absorption in red sandy loam soil.',
      category: 'fertilizer',
      categoryLabel: 'Pre-Order Input',
      field: 'Field 4 (Groundnut - 2.0 Acres)',
      timing: `Next Week (${nextWeekStr})`,
      dueDateLabel: 'Pre-Task',
      isCompleted: false,
      actionButtonText: 'Order from Farm Store (₹650)',
    },
  ];
}
