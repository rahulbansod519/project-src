import { Router, type IRouter } from "express";
import { TestApiKeysBody, TestApiKeysResponse } from "@workspace/api-zod";
import { didTestApiKey } from "../lib/did.js";
import { elevenlabsTestApiKey } from "../lib/elevenlabs.js";

const router: IRouter = Router();

router.post("/settings/test", async (req, res): Promise<void> => {
  const parsed = TestApiKeysBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { didApiKey, elevenlabsApiKey } = parsed.data;

  const [didValid, elevenlabsValid] = await Promise.all([
    didApiKey ? didTestApiKey(didApiKey) : Promise.resolve(false),
    elevenlabsApiKey ? elevenlabsTestApiKey(elevenlabsApiKey) : Promise.resolve(false),
  ]);

  const result = TestApiKeysResponse.parse({
    did: {
      valid: didValid,
      message: didApiKey
        ? didValid
          ? "D-ID API key is valid"
          : "D-ID API key is invalid or connection failed"
        : "No D-ID API key provided",
    },
    elevenlabs: {
      valid: elevenlabsValid,
      message: elevenlabsApiKey
        ? elevenlabsValid
          ? "ElevenLabs API key is valid"
          : "ElevenLabs API key is invalid or connection failed"
        : "No ElevenLabs API key provided",
    },
  });

  res.json(result);
});

export default router;
