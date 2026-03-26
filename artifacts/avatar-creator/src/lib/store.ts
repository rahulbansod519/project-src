import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  didApiKey: string;
  elevenlabsApiKey: string;
  setDidApiKey: (key: string) => void;
  setElevenlabsApiKey: (key: string) => void;
  isConfigured: () => boolean;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      didApiKey: '',
      elevenlabsApiKey: '',
      setDidApiKey: (key) => set({ didApiKey: key }),
      setElevenlabsApiKey: (key) => set({ elevenlabsApiKey: key }),
      isConfigured: () => {
        const state = get();
        return !!state.didApiKey;
      },
    }),
    {
      name: 'avatar-creator-settings',
    }
  )
);
