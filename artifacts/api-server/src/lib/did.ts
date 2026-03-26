const DID_API_BASE = "https://api.d-id.com";

/**
 * Build the Authorization header from whatever format the user pasted.
 * D-ID Studio copies a full "Basic YWJj..." string. If the user pastes
 * that directly we must NOT add a second "Basic " prefix.
 * Also handles raw keys (no prefix) by wrapping them in "Basic ".
 */
function authHeader(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.startsWith("Basic ") || trimmed.startsWith("Bearer ")) {
    return trimmed;
  }
  return `Basic ${trimmed}`;
}

export interface DIDCreateAvatarResult {
  avatarId: string;
  thumbnailUrl?: string;
}

export interface DIDVideoResult {
  videoId: string;
  status: string;
  videoUrl?: string;
}

export async function didCreateAvatar(
  apiKey: string,
  imageUrl: string,
  name: string
): Promise<DIDCreateAvatarResult> {
  const res = await fetch(`${DID_API_BASE}/clips/actors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(apiKey),
    },
    body: JSON.stringify({
      source_url: imageUrl,
      name,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`D-ID createActor failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { id: string; thumbnail_url?: string };
  return {
    avatarId: data.id,
    thumbnailUrl: data.thumbnail_url,
  };
}

const LANGUAGE_MICROSOFT_VOICE: Record<string, string> = {
  en: "en-US-JennyNeural",
  es: "es-ES-ElviraNeural",
  fr: "fr-FR-DeniseNeural",
  de: "de-DE-KatjaNeural",
  pt: "pt-BR-FranciscaNeural",
  ja: "ja-JP-NanamiNeural",
};

export async function didGenerateTalkVideo(
  apiKey: string,
  imageUrl: string,
  script: string,
  emotion: string = "neutral",
  language: string = "en",
  voiceId?: string,
  backgroundUrl?: string,
  backgroundColorHex?: string,
  stitch: boolean = false
): Promise<DIDVideoResult> {
  const body: Record<string, unknown> = {
    source_url: imageUrl,
  };

  if (voiceId) {
    body.script = {
      type: "text",
      input: script,
      ssml: false,
      provider: {
        type: "elevenlabs",
        voice_id: voiceId,
        voice_config: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: emotion === "neutral" ? 0 : 0.5,
          use_speaker_boost: true,
        },
      },
    };
  } else {
    const msVoice = LANGUAGE_MICROSOFT_VOICE[language] ?? "en-US-JennyNeural";

    body.script = {
      type: "text",
      input: script,
      ssml: false,
      provider: {
        type: "microsoft",
        voice_id: msVoice,
      },
    };
  }

  // `config` holds rendering options (stitch lives here)
  const config: Record<string, unknown> = {};
  if (stitch) config.stitch = true;
  if (Object.keys(config).length > 0) body.config = config;

  // `background` is a TOP-LEVEL field on the D-ID /talks request body
  if (backgroundColorHex) {
    body.background = { color: backgroundColorHex };
  } else if (backgroundUrl) {
    body.background = { source_url: backgroundUrl };
  }

  const res = await fetch(`${DID_API_BASE}/talks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(apiKey),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`D-ID generateTalk failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { id: string; status: string };
  return { videoId: data.id, status: data.status };
}

export async function didGetVideoStatus(
  apiKey: string,
  videoId: string,
  endpoint: "talks" | "clips" = "talks"
): Promise<{ status: string; videoUrl?: string; thumbnailUrl?: string }> {
  const res = await fetch(`${DID_API_BASE}/${endpoint}/${videoId}`, {
    headers: {
      Authorization: authHeader(apiKey),
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`D-ID getVideo failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    status: string;
    result_url?: string;
    thumbnail_url?: string;
  };
  return {
    status: data.status,
    videoUrl: data.result_url,
    thumbnailUrl: data.thumbnail_url,
  };
}

export async function didTestApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${DID_API_BASE}/credits`, {
      headers: { Authorization: authHeader(apiKey) },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function didUploadImage(
  apiKey: string,
  imageBase64: string
): Promise<string> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  const formData = new FormData();
  const blob = new Blob([buffer], { type: "image/jpeg" });
  formData.append("image", blob, "avatar.jpg");

  const res = await fetch(`${DID_API_BASE}/images`, {
    method: "POST",
    headers: {
      Authorization: authHeader(apiKey),
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`D-ID uploadImage failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { url: string };
  return data.url;
}
