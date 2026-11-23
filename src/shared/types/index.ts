export type ActiveTab =
  | 'overview'
  | 'my-crops'
  | 'crops'
  | 'crop-calendar'
  | 'calendar'
  | 'diseases-library'
  | 'diseases'
  | 'market-prices'
  | 'market'
  | 'crop-doctor'
  | 'doctor'
  | 'weather'
  | 'notifications'
  | 'profile'
  | 'landing';

export type Language = string;

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  category: 'regional_india' | 'global';
  regionLabel: string;
  flag?: string;
  popular?: boolean;
}

export interface CropSummary {
  id: string;
  name: string;
  variety: string;
  field: string;
  area: string;
  status: 'healthy' | 'attention' | 'critical';
  stage: string;
  days: number;
  progressPercent: number;
  icon: string;
}

export interface MandiItem {
  id: string;
  name: string;
  grade: string;
  price: number;
  unit: string;
  change: string;
  changePercent: number;
  isPositive: boolean;
  dailyArrival: string;
  modalPrice: number;
  msp?: number;
  overMsp?: string;
  arrivalPressure?: string;
  storageAdvice?: string;
  procurementDemand?: string;
  moistureAvg?: string;
}

export interface NearbyMandiArbitrage {
  mandi: string;
  distance: string;
  variety: string;
  minRate: number;
  maxRate: number;
  modalPrice: number;
  dailyArrival: string;
  netReturn: number;
  statusTag?: string;
  diffNote?: string;
}

export interface CorporateTender {
  id: string;
  company: string;
  subtitle: string;
  tags: string[];
  contractOffer: string;
  minLotSize?: string;
  paymentTerms?: string;
  targetCrop?: string;
  farmgatePickup?: string;
  targetVariety?: string;
  spotAdvance?: string;
  actionText: string;
  phone?: string;
}

export interface DiseaseThreat {
  id: string;
  name: string;
  scientificName: string;
  crop: 'paddy' | 'chilli' | 'maize' | 'groundnut';
  fieldTag: string;
  severity: 'high' | 'moderate' | 'preventative';
  severityLabel: string;
  imageUrl: string;
  symptoms: string;
  solution: string;
  preventiveCare: string;
  treatmentPrice: number;
}

export interface CalendarTask {
  id: string;
  title: string;
  description: string;
  category: 'fertilizer' | 'pest' | 'irrigation' | 'harvest' | 'general';
  categoryLabel: string;
  field: string;
  timing: string;
  dueDateLabel: string;
  isCompleted: boolean;
  actionButtonText: string;
  guideButtonText?: string;
}

export interface UserProfile {
  id: string;
  rawId?: string;
  name: string;
  phone: string;
  email?: string;
  role: string;
  farmerPartner: string;
  holding: string;
  location: string;
  country?: string;
  state?: string;
  district?: string;
  village?: string;
  pincode?: string;
  cropId?: number;
  primaryCrop?: string;
  latitude?: number;
  longitude?: number;
  station: string;
  kisanId: string;
  pmfbyPolicy: string;
  insuredSum: string;
  linkedBankMask: string;
  avatar: string;
  landscape: string;
  registeredParcelsCount: number;
}

export interface RegisterRequestPayload {
  mobile: string; // International format e.g. +919876543210
  email?: string;
  full_name: string;
  crop_id: number;
  country: string;
  district: string;
  state: string;
  pincode: string;
  village: string;
  latitude?: number;
  longitude?: number;
}

export interface UpdateProfileRequestPayload {
  full_name: string;
  photo_url: string | null;
  email: string | null;
  mobile: string;
  crop_id: number;
  country: string;
  state: string;
  district: string;
  village?: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
}

export interface DetectedAddress {
  latitude: number;
  longitude: number;
  label?: string;
  state: string;
  district: string;
  village: string;
  pincode: string;
  country?: string;
}

export interface CropOptionItem {
  id: number;
  label: string;
  slug?: string;
  category?: string | null;
  season?: string | null;
  sourceName?: string | null;
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
  label: string;
  state?: string;
  district?: string;
  village?: string;
  pincode?: string;
  source: 'default' | 'gps' | 'manual' | 'profile';
}

export interface WeatherMeta {
  latitude: number;
  longitude: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
}

export interface CurrentWeatherData {
  time: string;
  interval: number;
  temperature_2m: number;
  relative_humidity_2m: number;
  apparent_temperature: number;
  is_day: number;
  precipitation: number;
  rain: number;
  weather_code: number;
  cloud_cover: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  wind_gusts_10m: number;
}

export interface DailyForecastItem {
  date: string;
  weather_code: number;
  temperature_2m_max: number;
  temperature_2m_min: number;
  apparent_temperature_max: number;
  apparent_temperature_min: number;
  precipitation_sum: number;
  precipitation_probability_max: number;
  sunrise: string;
  sunset: string;
  wind_speed_10m_max: number;
}

export interface HourlyForecastItem {
  time: string;
  temperature_2m: number;
  relative_humidity_2m: number;
  precipitation_probability: number;
  precipitation: number;
  weather_code: number;
  wind_speed_10m: number;
}

export interface CountryOption {
  iso: string;
  name: string;
  dialCode: string;
  minDigits: number;
  maxDigits: number;
}

export interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  message?: string;
  category?: 'weather' | 'mandi' | 'crops' | 'crop' | 'govt' | 'system' | string;
  categoryLabel?: string;
  type?: string;
  time: string;
  group?: 'today' | 'yesterday' | 'earlier' | string;
  isUnread?: boolean;
  read?: boolean;
  isPersonal?: boolean;
  severity?: string;
  severityTag?: string;
  actionUrlTab?: ActiveTab;
  actionPath?: string;
  actionLabel?: string;
  sparkline?: boolean;
}

export interface AiChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actions?: { label: string; tab?: ActiveTab; actionType?: string }[];
}

export interface WeatherAdvisoryRequest {
  user_id: number;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  crop_stage: string | null;
  language: string;
  forecast_days: number;
}

export interface WeatherAdvisoryAlertWindow {
  window: string;
  expected_time: string;
  forecast_based: boolean;
  official_warning: boolean;
  source_type: string;
}

export interface WeatherAdvisoryAlert {
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  window: string;
  expected_time: string;
  description: string;
  potential_crop_impact: string;
  farmer_action: string;
  observed_metrics?: Record<string, number | string | null>;
  forecast_based?: boolean;
  official_warning?: boolean;
  windows?: WeatherAdvisoryAlertWindow[];
  source_types?: string[];
  expected_times?: string[];
}

export interface WeatherAdvisoryEvidence {
  title: string;
  url?: string;
  supports?: string;
}

export interface WeatherAdvisoryCropIdentity {
  status: string;
  common_name: string | null;
  scientific_name: string | null;
  matched_database_name?: string | null;
  production_purpose: string;
  purpose_confidence?: string;
  confidence: string;
  resolution_basis?: string[];
  evidence?: WeatherAdvisoryEvidence[];
  farmer_confirmation_required?: boolean;
  note?: string;
}

export interface WeatherAdvisoryBasedAction {
  action: string;
  trigger: string;
  observed_value?: string;
  priority: 'high' | 'medium' | 'low' | string;
  basis: string;
}

export interface WeatherAdvisoryCropSpecificRecommendations {
  status: string;
  crop_name: string | null;
  crop_identity: WeatherAdvisoryCropIdentity;
  weather_based_actions: WeatherAdvisoryBasedAction[];
  verified_agronomic_recommendations: Array<string | Record<string, unknown>>;
  evidence_status?: string;
  note?: string;
}

export interface FarmerActionPlanItem {
  action: string;
  reason: string;
  priority: 'high' | 'medium' | 'low' | string;
  alert_type?: string;
  expected_time?: string;
  source_type: string;
}

export interface FarmerActionPlan {
  immediate: FarmerActionPlanItem[];
  next_24_hours: FarmerActionPlanItem[];
  next_3_7_days: FarmerActionPlanItem[];
}

export interface WeatherAdvisoryDataQuality {
  weather_data_timestamp: string;
  soil_data_timestamp: string | null;
  advisory_generated_at: string;
  missing_information: string[];
  confidence: string;
}

export interface WeatherAdvisoryResponse {
  success: boolean;
  farmer_type: string;
  language: string;
  last_updated: string;
  next_update: string;
  location: {
    village: string | null;
    district: string | null;
    state: string | null;
    label: string | null;
  };
  weather: {
    current: {
      temperature_c: number;
      feels_like_c: number;
      humidity_percent: number;
      rainfall_mm: number;
      wind_speed_kmh: number;
      wind_gust_kmh: number;
      weather_code: number;
      observed_at: string;
    };
    temperature_forecast: {
      current_c: number;
      apparent_c: number;
      today_min_c: number;
      today_max_c: number;
      tomorrow_min_c: number;
      tomorrow_max_c: number;
      next_24h_min_c: number;
      next_24h_max_c: number;
    };
    daily_forecast: Array<{
      date: string;
      minimum_temperature_c: number;
      maximum_temperature_c: number;
      rainfall_mm: number;
      rain_probability_percent: number;
      maximum_wind_gust_kmh: number;
    }>;
    hourly_forecast_available: boolean;
    timezone: string;
    forecast_retrieved_at: string;
  };
  crop_information: {
    crop_name: string | null;
    scientific_name: string | null;
    crop_identity_status: string;
    production_purpose: string;
    database_crop_season: string | null;
    growth_stage: string | null;
    soil_type: string | null;
    soil_ph: string | number | null;
    soil_moisture: string | number | null;
    current_season: string;
    upcoming_season: string;
  };
  advisory: {
    crop_name: string | null;
    crop_stage: string | null;
    current_season: string;
    upcoming_season: string;
    season_note: string;
    weather_summary: string;
    weather_alerts: WeatherAdvisoryAlert[];
    crop_protection: string[];
    irrigation_recommendations: string[];
    crop_care_recommendations: string[];
    preventive_measures: string[];
    summary: string;
    crop_identity?: WeatherAdvisoryCropIdentity;
    crop_specific_recommendations?: WeatherAdvisoryCropSpecificRecommendations;
    suitable_crops?: Array<string | { crop_name?: string; name?: string; reason?: string; note?: string; season?: string }>;
    alternative_crops?: Array<string | { crop_name?: string; name?: string; reason?: string; note?: string; season?: string }>;
    crop_recommendation_status?: string;
    crop_recommendation_note?: string;
  };
  farmer_action_plan: FarmerActionPlan;
  data_quality: WeatherAdvisoryDataQuality;
}
