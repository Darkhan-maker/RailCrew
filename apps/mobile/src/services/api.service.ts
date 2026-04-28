import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LoginDto, RegisterDto, AuthResponse,
  CreateTripDto, UpdateTripDto, TripQuery, TripListResponse, Trip,
  SummaryQuery, Summary,
  CreateSalaryRuleDto, UpdateSalaryRuleDto, SalaryRule,
} from '@railcrew/contracts';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://railcrewapi-production.up.railway.app/api/v1';

export const http = axios.create({ baseURL: BASE_URL, timeout: 8000 });
http.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only log real server errors (response received). Network failures
    // (no response, status undefined) are expected in offline mode — skip them.
    if (error?.response) {
      console.warn('API error', error.config?.url, error.response.status, error.response.data);
    }
    return Promise.reject(error);
  }
);

http.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auth
export const authApi = {
  register: (dto: RegisterDto) =>
    http.post<AuthResponse>('/auth/register', dto).then((r) => r.data),
  login: (dto: LoginDto) =>
    http.post<AuthResponse>('/auth/login', dto).then((r) => r.data),
};

// Trips
export const tripsApi = {
  create: (dto: CreateTripDto) =>
    http.post<Trip>('/trips', dto).then((r) => r.data),
  list: (query?: Partial<TripQuery>) =>
    http.get<TripListResponse>('/trips', { params: query }).then((r) => r.data),
  get: (id: string) =>
    http.get<Trip>(`/trips/${id}`).then((r) => r.data),
  update: (id: string, dto: UpdateTripDto) =>
    http.patch<Trip>(`/trips/${id}`, dto).then((r) => r.data),
  remove: (id: string) =>
    http.delete(`/trips/${id}`).then((r) => r.data),
};

// Summary
export const summaryApi = {
  get: (query: SummaryQuery) =>
    http.get<Summary>('/summary', { params: query }).then((r) => r.data),
};

// Export
export const exportApi = {
  downloadPeriodPdf: (from: string, to: string) =>
    http.get<ArrayBuffer>('/export/trips/pdf', { params: { from, to }, responseType: 'arraybuffer' }).then((r) => r.data),
  downloadPeriodXlsx: (from: string, to: string) =>
    http.get<ArrayBuffer>('/export/trips/xlsx', { params: { from, to }, responseType: 'arraybuffer' }).then((r) => r.data),
  downloadTripPdf: (id: string) =>
    http.get<ArrayBuffer>(`/export/trips/${id}/pdf`, { responseType: 'arraybuffer' }).then((r) => r.data),
};

// Telegram
export const telegramApi = {
  generateCode: () =>
    http.post<{ code: string }>('/telegram/generate-code').then((r) => r.data),
};

// Salary rules
export const salaryApi = {
  create: (dto: CreateSalaryRuleDto) =>
    http.post<SalaryRule>('/salary/rules', dto).then((r) => r.data),
  list: () =>
    http.get<SalaryRule[]>('/salary/rules').then((r) => r.data),
  update: (id: string, dto: UpdateSalaryRuleDto) =>
    http.patch<SalaryRule>(`/salary/rules/${id}`, dto).then((r) => r.data),
  remove: (id: string) =>
    http.delete(`/salary/rules/${id}`).then((r) => r.data),
};
