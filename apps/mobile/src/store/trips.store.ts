import { create } from 'zustand';
import { CreateTripDto } from '@railcrew/contracts';
import { LocalTrip, LocalCreateTripDto, localTripsStorage } from '../services/storage.service';
import { tripsApi } from '../services/api.service';

// Strip mobile-only fields before sending to API, then remove any null values.
// CreateTripDtoSchema uses .optional() (not .nullish()), so null is rejected by
// the backend. Converting null → undefined means the key is omitted from JSON.
function toContractDto(dto: LocalCreateTripDto): CreateTripDto {
  const {
    meterStart, meterEnd,
    sectionMeters,
    nightMinutes,
    ...contractDto
  } = dto;
  void meterStart; void meterEnd;
  void sectionMeters;
  void nightMinutes;

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(contractDto)) {
    if (v !== null) result[k] = v;
  }
  return result as CreateTripDto;
}

interface TripsState {
  trips: LocalTrip[];
  isLoading: boolean;
  loadLocal: () => Promise<void>;
  addTrip: (dto: LocalCreateTripDto, isOnline: boolean) => Promise<LocalTrip>;
  updateTrip: (id: string, patch: Partial<LocalCreateTripDto>) => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  syncPending: () => Promise<void>;
}

export const useTripsStore = create<TripsState>((set, get) => ({
  trips: [],
  isLoading: false,

  loadLocal: async () => {
    set({ isLoading: true });
    const trips = await localTripsStorage.getAll();
    set({ trips, isLoading: false });
  },

  addTrip: async (dto: LocalCreateTripDto, isOnline: boolean) => {
    if (isOnline) {
      const trip = await tripsApi.create(toContractDto(dto));
      const local = await localTripsStorage.save({ ...dto, localId: trip.id });
      await localTripsStorage.markSynced(local.localId!, trip.id);
      // Server response now includes all stable work-cycle fields.
      // Only add truly local-only fields on top.
      const localTrip: LocalTrip = {
        ...trip,
        meterStart: dto.meterStart,
        meterEnd: dto.meterEnd,
        sectionMeters: dto.sectionMeters,
        nightMinutes: dto.nightMinutes,
      };
      set((s) => ({ trips: [localTrip, ...s.trips] }));
      return localTrip;
    } else {
      const trip = await localTripsStorage.save(dto);
      set((s) => ({ trips: [trip, ...s.trips] }));
      return trip;
    }
  },

  updateTrip: async (id: string, patch: Partial<LocalCreateTripDto>) => {
    await localTripsStorage.update(id, patch);
    const trips = await localTripsStorage.getAll();
    set({ trips });
    try {
      const {
        meterStart, meterEnd,
        sectionMeters,
        nightMinutes,
        ...contractPatch
      } = patch;
      void meterStart; void meterEnd;
      void sectionMeters;
      void nightMinutes;
      const cleanPatch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(contractPatch)) {
        if (v !== null) cleanPatch[k] = v;
      }
      await tripsApi.update(id, cleanPatch as typeof contractPatch);
    } catch {
      // offline — saved locally
    }
  },

  deleteTrip: async (id: string) => {
    set((s) => ({ trips: s.trips.filter((t) => t.id !== id && t.localId !== id) }));
    await localTripsStorage.remove(id);
    try {
      await tripsApi.remove(id);
    } catch {
      // offline or local-only — already removed from local storage
    }
  },

  syncPending: async () => {
    const unsynced = await localTripsStorage.getUnsynced();
    for (const trip of unsynced) {
      try {
        const created = await tripsApi.create({
          routeFrom: trip.routeFrom,
          routeTo: trip.routeTo,
          date: trip.date,
          endDate: trip.endDate ?? undefined,
          startTime: trip.startTime,
          endTime: trip.endTime,
          durationMinutes: trip.durationMinutes,
          tripType: trip.tripType,
          status: trip.status,
          notes: trip.notes ?? undefined,
          localId: trip.localId ?? undefined,
          // Stable work-cycle fields
          trainNumber: trip.trainNumber ?? undefined,
          trainWeight: trip.trainWeight ?? undefined,
          axleCount: trip.axleCount ?? undefined,
          locoModel: trip.locoModel ?? undefined,
          locoNumber: trip.locoNumber ?? undefined,
          appearanceDate: trip.appearanceDate ?? undefined,
          appearanceTime: trip.appearanceTime ?? undefined,
          handoverDate: trip.handoverDate ?? undefined,
          handoverTime: trip.handoverTime ?? undefined,
          sectionCount: trip.sectionCount ?? undefined,
        });
        await localTripsStorage.markSynced(trip.localId!, created.id);
      } catch {
        // retry next time
      }
    }
    await get().loadLocal();
  },
}));
