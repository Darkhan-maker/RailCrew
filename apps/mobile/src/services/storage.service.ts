import AsyncStorage from '@react-native-async-storage/async-storage';
import { Trip, CreateTripDto, TripType } from '@railcrew/contracts';

// ─── Mobile-only extended trip shape ─────────────────────────────────────────
// These fields are NOT in the backend/contracts schema.
// They live only in local AsyncStorage and are stripped before any API call.
//
// trainNumber, trainWeight, axleCount, locoModel, locoNumber,
// appearanceDate/Time, handoverDate/Time, sectionCount
// are now part of Trip (contracts) and no longer listed here.

export type SectionMeter = {
  start?: number;
  end?: number;
};

export type LocalTripExtra = {
  meterStart?: number;      // backward-compat alias for sectionMeters[0].start
  meterEnd?: number;        // backward-compat alias for sectionMeters[0].end
  sectionMeters?: SectionMeter[];
  nightMinutes?: number;
  holidayMinutes?: number;
};

export type LocalTrip = Trip & LocalTripExtra;
export type LocalCreateTripDto = CreateTripDto & LocalTripExtra;

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const KEYS = {
  TRIPS: 'local_trips',
  TOKEN: 'access_token',
  USER: 'user',
  SALARY_RULE: 'local_salary_rule',
  ROUTES: 'local_routes',
  SETTINGS: 'local_settings',
};

// ─── Маршруты ────────────────────────────────────────────────────────────────

export type LocalRoute = {
  id: string;
  routeFrom: string;
  routeTo: string;
  tripType: TripType;
};

export const localRoutesStorage = {
  async getAll(): Promise<LocalRoute[]> {
    const raw = await AsyncStorage.getItem(KEYS.ROUTES);
    return raw ? (JSON.parse(raw) as LocalRoute[]) : [];
  },

  async save(route: Omit<LocalRoute, 'id'>): Promise<LocalRoute> {
    const routes = await this.getAll();
    const exists = routes.find(
      (r) => r.routeFrom === route.routeFrom && r.routeTo === route.routeTo && r.tripType === route.tripType,
    );
    if (exists) return exists;
    const newRoute: LocalRoute = { ...route, id: randomUUID() };
    routes.unshift(newRoute);
    await AsyncStorage.setItem(KEYS.ROUTES, JSON.stringify(routes));
    return newRoute;
  },

  async remove(id: string): Promise<void> {
    const routes = await this.getAll();
    await AsyncStorage.setItem(KEYS.ROUTES, JSON.stringify(routes.filter((r) => r.id !== id)));
  },
};

// ─── Зарплата ────────────────────────────────────────────────────────────────

export type LocalSalaryRule = {
  ratePerHour: number;
  tripBonus: number;
  nightCoefficient: number;
  overtimeCoefficient: number;
  monthlyHoursThreshold: number;
  harmfulnessPercent: number;
  classPercent: number;
  zonalPercent: number;
  regionalCoefficient: number;
  unionPercent: number;
  taxPercent: number;
  holidayCoefficient: number;
  tripBonusPerHour: number;
};

const DEFAULT_SALARY_RULE: LocalSalaryRule = {
  ratePerHour: 0,
  tripBonus: 0,
  nightCoefficient: 1.4,
  overtimeCoefficient: 1.5,
  monthlyHoursThreshold: 176,
  harmfulnessPercent: 0,
  classPercent: 0,
  zonalPercent: 0,
  regionalCoefficient: 1,
  unionPercent: 1,
  taxPercent: 13,
  holidayCoefficient: 2,
  tripBonusPerHour: 0,
};

export const localSalaryStorage = {
  async get(): Promise<LocalSalaryRule> {
    const raw = await AsyncStorage.getItem(KEYS.SALARY_RULE);
    if (!raw) return DEFAULT_SALARY_RULE;
    const parsed = JSON.parse(raw) as Partial<LocalSalaryRule>;
    return { ...DEFAULT_SALARY_RULE, ...parsed };
  },

  async save(rule: LocalSalaryRule): Promise<void> {
    await AsyncStorage.setItem(KEYS.SALARY_RULE, JSON.stringify(rule));
  },
};

// ─── Настройки приложения ────────────────────────────────────────────────────

export type LocalSettings = {
  // Часовой пояс: разница с московским временем в часах (-2..+9)
  timezoneOffsetFromMoscow: number;
  // Норма часов на месяц
  monthlyHoursNorm: number;
  // Локомотив по умолчанию
  defaultLocoModel: string;
  defaultLocoNumber: string;
  // Учёт электроэнергии (вкл/выкл)
  trackElectricity: boolean;
  // Учёт ночных часов (вкл/выкл)
  trackNightHours: boolean;
  // Границы ночного времени (по умолчанию 22:00–06:00)
  nightStartHour: number;
  nightEndHour: number;
  // Учёт следования пассажиром
  trackPassengerTravel: boolean;
};

const DEFAULT_SETTINGS: LocalSettings = {
  timezoneOffsetFromMoscow: 3, // Казахстан: Москва +3
  monthlyHoursNorm: 176,
  defaultLocoModel: '',
  defaultLocoNumber: '',
  trackElectricity: false,
  trackNightHours: true,
  nightStartHour: 22,
  nightEndHour: 6,
  trackPassengerTravel: true,
};

export const localSettingsStorage = {
  async get(): Promise<LocalSettings> {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LocalSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  },

  async save(settings: LocalSettings): Promise<void> {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  },

  async patch(patch: Partial<LocalSettings>): Promise<LocalSettings> {
    const current = await this.get();
    const updated = { ...current, ...patch };
    await this.save(updated);
    return updated;
  },
};

// ─── Поездки (offline-first) ─────────────────────────────────────────────────

export const localTripsStorage = {
  async getAll(): Promise<LocalTrip[]> {
    const raw = await AsyncStorage.getItem(KEYS.TRIPS);
    return raw ? (JSON.parse(raw) as LocalTrip[]) : [];
  },

  async save(dto: LocalCreateTripDto): Promise<LocalTrip> {
    const trips = await this.getAll();
    const now = new Date();
    const trip: LocalTrip = {
      ...dto,
      id: randomUUID(),
      userId: '',
      localId: dto.localId ?? randomUUID(),
      status: dto.status ?? 'CONFIRMED',
      syncedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    trips.unshift(trip);
    await AsyncStorage.setItem(KEYS.TRIPS, JSON.stringify(trips));
    return trip;
  },

  async update(localId: string, patch: Partial<LocalTrip>): Promise<void> {
    const trips = await this.getAll();
    const idx = trips.findIndex((t) => t.localId === localId || t.id === localId);
    if (idx === -1) return;
    trips[idx] = { ...trips[idx], ...patch, updatedAt: new Date() };
    await AsyncStorage.setItem(KEYS.TRIPS, JSON.stringify(trips));
  },

  async markSynced(localId: string, serverId: string): Promise<void> {
    await this.update(localId, { id: serverId, syncedAt: new Date() });
  },

  async remove(id: string): Promise<void> {
    const trips = await this.getAll();
    const filtered = trips.filter((t) => t.id !== id && t.localId !== id);
    await AsyncStorage.setItem(KEYS.TRIPS, JSON.stringify(filtered));
  },

  async getUnsynced(): Promise<LocalTrip[]> {
    const trips = await this.getAll();
    return trips.filter((t) => !t.syncedAt);
  },

  async mergeFromServer(serverTrips: Trip[]): Promise<void> {
    const local = await this.getAll();
    const knownIds = new Set(local.map((t) => t.id));
    const toAdd: LocalTrip[] = serverTrips
      .filter((st) => !knownIds.has(st.id))
      .map((st) => ({
        ...st,
        syncedAt: st.syncedAt ?? new Date(),
      } as LocalTrip));
    if (toAdd.length === 0) return;
    const merged = [...toAdd, ...local].sort(
      (a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0),
    );
    await AsyncStorage.setItem(KEYS.TRIPS, JSON.stringify(merged));
  },

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.TRIPS);
  },
};

export const tokenStorage = {
  get: () => AsyncStorage.getItem(KEYS.TOKEN),
  set: (token: string) => AsyncStorage.setItem(KEYS.TOKEN, token),
  remove: () => AsyncStorage.removeItem(KEYS.TOKEN),
};

// ─── Резервная копия ─────────────────────────────────────────────────────────

export type BackupData = {
  version: 2;
  exportedAt: string;
  trips: LocalTrip[];
  salaryRule: LocalSalaryRule;
  routes: LocalRoute[];
  settings: LocalSettings;
};

export const backupStorage = {
  async export(): Promise<string> {
    const [trips, salaryRule, routes, settings] = await Promise.all([
      localTripsStorage.getAll(),
      localSalaryStorage.get(),
      localRoutesStorage.getAll(),
      localSettingsStorage.get(),
    ]);

    const backup: BackupData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      trips,
      salaryRule,
      routes,
      settings,
    };

    return JSON.stringify(backup, null, 2);
  },

  async import(json: string): Promise<{ trips: number; routes: number }> {
    let data: any;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('Файл повреждён или имеет неверный формат');
    }

    if ((!data.version || ![1, 2].includes(data.version)) || !Array.isArray(data.trips)) {
      throw new Error('Неподдерживаемая версия резервной копии');
    }

    const promises: Promise<void>[] = [
      AsyncStorage.setItem(KEYS.TRIPS, JSON.stringify(data.trips)),
      AsyncStorage.setItem(
        KEYS.SALARY_RULE,
        JSON.stringify(data.salaryRule ?? { ratePerHour: 0, tripBonus: 0, nightCoefficient: 1.4, overtimeCoefficient: 1.5, monthlyHoursThreshold: 176 }),
      ),
      AsyncStorage.setItem(KEYS.ROUTES, JSON.stringify(data.routes ?? [])),
    ];

    // Настройки есть только в v2
    if (data.version >= 2 && data.settings) {
      promises.push(AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(data.settings)));
    }

    await Promise.all(promises);

    return { trips: data.trips.length, routes: (data.routes ?? []).length };
  },
};
