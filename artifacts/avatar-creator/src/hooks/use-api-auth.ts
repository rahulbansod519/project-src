import { useSettingsStore } from "@/lib/store";

export function useApiAuth() {
  const { didApiKey, elevenlabsApiKey } = useSettingsStore();

  return {
    headers: {
      "X-DID-Api-Key": didApiKey || "",
      "X-ElevenLabs-Api-Key": elevenlabsApiKey || "",
    },
  };
}
