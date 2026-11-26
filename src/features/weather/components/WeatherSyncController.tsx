/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import {
  selectAuthUser,
  selectIsAuthenticated,
  selectProfileUi,
} from '../../auth/store/authSlice';
import { resolveProfileImdIds } from '../services/imdWeatherApi';
import {
  fetchWeatherBundle,
  resolveManualAddressCoords,
  selectPendingAddressQuery,
  selectWeatherLatitude,
  selectWeatherLocation,
  selectWeatherLongitude,
} from '../store/weatherSlice';

/**
 * Isolated zero-DOM controller that keeps weather telemetry synchronized with
 * the active coordinates, profile IMD station ID (IMD-first + fallback), and logged-in user ID.
 */
export const WeatherSyncController = memo(() => {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectAuthUser);
  const { profileLoaded, profileError, locationSyncing } = useAppSelector(selectProfileUi);
  const latitude = useAppSelector(selectWeatherLatitude);
  const longitude = useAppSelector(selectWeatherLongitude);
  const pendingAddressQuery = useAppSelector(selectPendingAddressQuery);
  const location = useAppSelector(selectWeatherLocation);

  const rawUserId =
    isAuthenticated && user
      ? (user.rawId || user.id.replace(/^farmer-/, '')).trim() || undefined
      : undefined;

  const { stationId: effectiveStationId } = useMemo(
    () => resolveProfileImdIds(location, isAuthenticated ? user : null),
    [isAuthenticated, location, user]
  );

  // Wait for initial profile fetch or in-flight location sync before dispatching weather
  // so logged-in users immediately try their profile IMD station_id without redundant pre-calls.
  const waitingForProfileIds = Boolean(
    isAuthenticated &&
      (locationSyncing || (!profileLoaded && !profileError && !effectiveStationId))
  );

  useEffect(() => {
    if (waitingForProfileIds) return;
    dispatch(
      fetchWeatherBundle({
        userId: rawUserId,
        latitude,
        longitude,
        stationId: effectiveStationId,
      })
    );
  }, [dispatch, waitingForProfileIds, rawUserId, latitude, longitude, effectiveStationId]);

  useEffect(() => {
    if (!pendingAddressQuery) return;
    dispatch(
      resolveManualAddressCoords({
        addressQuery: pendingAddressQuery,
        state: location.state,
        district: location.district,
        village: location.village,
        pincode: location.pincode,
        country: user?.country,
      })
    );
  }, [
    dispatch,
    pendingAddressQuery,
    location.state,
    location.district,
    location.village,
    location.pincode,
    user?.country,
  ]);

  return null;
});
