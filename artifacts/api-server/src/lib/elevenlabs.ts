const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

export async function elevenlabsCloneVoice(
  apiKey: string,
  audioBase64: string,
  voiceName: string
): Promise<{ voiceId: string }> {
  const base64Data = audioBase64.replace(/^data:audio\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  const formData = new FormData();
  formData.append("name", voiceName);
  const blob = new Blob([buffer], { type: "audio/mpeg" });
  formData.append("files", blob, "voice_sample.mp3");

  const res = await fetch(`${ELEVENLABS_API_BASE}/voices/add`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs cloneVoice failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { voice_id: string };
  return { voiceId: data.voice_id };
}

export async function elevenlabsTestApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${ELEVENLABS_API_BASE}/user`, {
      headers: { "xi-api-key": apiKey },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function elevenlabsListVoices(apiKey: string): Promise<{ voice_id: string; name: string }[]> {
  const res = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs listVoices failed: ${res.status}`);
  }

  const data = (await res.json()) as { voices: { voice_id: string; name: string }[] };
  return data.voices;
}
