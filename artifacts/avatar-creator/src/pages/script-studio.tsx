import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useListAvatars, useGenerateVideo } from "@workspace/api-client-react";
import { useApiAuth } from "@/hooks/use-api-auth";
import { useSettingsStore } from "@/lib/store";
import { motion } from "framer-motion";
import { Clapperboard, Sparkles, Image as ImageIcon, Volume2, Globe, AlertTriangle, Settings, ChevronDown, ChevronUp, Maximize2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const EMOTIONS = ["neutral", "happy", "sad", "excited", "calm", "confident", "serious"] as const;
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "ja", name: "Japanese" },
];

const BG_COLOR_SWATCHES = [
  { hex: "#0f0f1a", label: "Deep Space" },
  { hex: "#1a1a2e", label: "Midnight Blue" },
  { hex: "#0d1b2a", label: "Navy" },
  { hex: "#1a2e1a", label: "Forest" },
  { hex: "#2e1a1a", label: "Crimson Dark" },
  { hex: "#1e1e1e", label: "Charcoal" },
  { hex: "#ffffff", label: "White" },
  { hex: "#f0f0f0", label: "Light Grey" },
  { hex: "#e8e0d4", label: "Warm Ivory" },
  { hex: "#d4e8e0", label: "Sage" },
];

export default function ScriptStudio() {
  const searchString = useSearch();
  const avatarIdParam = new URLSearchParams(searchString).get("avatarId");

  const [selectedAvatar, setSelectedAvatar] = useState(avatarIdParam || "");
  const [script, setScript] = useState("");
  const [emotion, setEmotion] = useState<typeof EMOTIONS[number]>("neutral");
  const [language, setLanguage] = useState("en");

  const [bgType, setBgType] = useState<"none" | "image" | "color">("none");
  const [bgUrl, setBgUrl] = useState("");
  const [bgColorHex, setBgColorHex] = useState("#1a1a2e");
  const [customBgColor, setCustomBgColor] = useState("");
  const [stitch, setStitch] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const auth = useApiAuth();
  const { didApiKey } = useSettingsStore();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: avatars, isLoading: loadingAvatars } = useListAvatars({ request: auth });
  const generateVideo = useGenerateVideo({ request: auth });

  const handlePreviewAudio = async (): Promise<void> => {
    if (!selectedAvatar) {
      toast({ title: "Select an avatar first", description: "Preview uses your cloned voice.", variant: "destructive" });
      return;
    }
    if (!script.trim()) {
      toast({ title: "Script is empty", variant: "destructive" });
      return;
    }
    setPreviewLoading(true);
    setPreviewAudioUrl(null);
    try {
      const res = await fetch("/api/preview-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarId: selectedAvatar || undefined, script: script.trim(), language }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { audioUrl } = await res.json() as { audioUrl: string };
      setPreviewAudioUrl(audioUrl);
    } catch (err) {
      toast({ title: "Audio preview failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const readyAvatars = avatars?.filter(a => a.status === "ready" && a.imageUrl) || [];

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (!selectedAvatar) {
      toast({ title: "Select an avatar", variant: "destructive" });
      return;
    }

    const avatar = readyAvatars.find(a => a.id === selectedAvatar);
    if (!avatar?.imageUrl) {
      toast({
        title: "Avatar has no source image",
        description: "Avatar has no source image. Please recreate it in Capture Studio.",
        variant: "destructive",
      });
      return;
    }

    if (!script.trim()) {
      toast({ title: "Script is empty", variant: "destructive" });
      return;
    }
    if (script.length > 1000) {
      toast({ title: "Script too long (max 1000 chars)", variant: "destructive" });
      return;
    }

    const resolvedBgColor = bgType === "color" ? (customBgColor.trim() || bgColorHex) : undefined;
    const resolvedBgUrl = bgType === "image" ? (bgUrl.trim() || undefined) : undefined;

    try {
      await generateVideo.mutateAsync({
        data: {
          avatarId: selectedAvatar,
          script: script.trim(),
          emotion,
          language,
          backgroundUrl: resolvedBgUrl ?? null,
          backgroundColorHex: resolvedBgColor ?? null,
          stitch,
        },
      });
      toast({ title: "Video processing started!" });
      setLocation(`/videos`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      toast({ title: "Failed to generate video", description: message, variant: "destructive" });
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mx-auto">
      <div className="mb-10 text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-primary/20 shadow-lg shadow-primary/10">
          <Clapperboard className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-4xl font-display font-bold text-white mb-2">Script Studio</h1>
        <p className="text-muted-foreground text-lg">Direct your digital clone. Write the script, set the tone, and generate.</p>
      </div>


      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-panel-heavy rounded-2xl p-6">
            <label className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
              <Globe className="w-5 h-5 text-primary" /> The Script
            </label>
            <textarea
              value={script}
              onChange={e => setScript(e.target.value)}
              placeholder="Enter the text you want your avatar to speak..."
              className="w-full h-64 bg-black/40 border border-white/10 rounded-xl p-5 text-white/90 text-lg leading-relaxed resize-none focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-white/20"
            />
            <div className="flex justify-end mt-2">
              <span className={`text-xs ${script.length > 1000 ? "text-red-400" : "text-white/40"}`}>
                {script.length} / 1000 chars
              </span>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-accent" /> Tone & Emotion
            </h3>
            <div className="flex flex-wrap gap-3">
              {EMOTIONS.map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmotion(e)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all border ${
                    emotion === e
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-black/30 border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Appearance Panel */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setAppearanceOpen(o => !o)}
              className="w-full flex items-center justify-between p-6 text-left hover:bg-white/5 transition-colors"
            >
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Maximize2 className="w-5 h-5 text-primary" /> Video Appearance
              </h3>
              {appearanceOpen
                ? <ChevronUp className="w-4 h-4 text-white/50" />
                : <ChevronDown className="w-4 h-4 text-white/50" />}
            </button>

            {appearanceOpen && (
              <div className="px-6 pb-6 space-y-6 border-t border-white/5 pt-6">

                {/* Full-body output toggle */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <p className="text-sm font-semibold text-white">Full-body output</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Shows your full captured body instead of an animated head close-up</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStitch(s => !s)}
                      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${stitch ? 'bg-primary' : 'bg-white/20'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${stitch ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>

                {/* Background type selector */}
                <div>
                  <p className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-accent" /> Background
                  </p>
                  <div className="flex gap-2 mb-4">
                    {(["none", "color", "image"] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setBgType(t)}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all border ${
                          bgType === t
                            ? "bg-primary/20 border-primary text-primary"
                            : "bg-black/30 border-white/10 text-white/50 hover:border-white/25"
                        }`}
                      >
                        {t === "none" ? "Default" : t === "color" ? "Color" : "Image URL"}
                      </button>
                    ))}
                  </div>

                  {bgType === "color" && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {BG_COLOR_SWATCHES.map(sw => (
                          <button
                            key={sw.hex}
                            type="button"
                            title={sw.label}
                            onClick={() => { setBgColorHex(sw.hex); setCustomBgColor(""); }}
                            className={`w-8 h-8 rounded-lg border-2 transition-all hover:scale-110 ${
                              bgColorHex === sw.hex && !customBgColor
                                ? "border-primary scale-110 shadow-md shadow-primary/30"
                                : "border-white/20"
                            }`}
                            style={{ backgroundColor: sw.hex }}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={customBgColor || bgColorHex}
                          onChange={e => setCustomBgColor(e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer border border-white/20 bg-transparent"
                          title="Custom color"
                        />
                        <input
                          type="text"
                          value={customBgColor || bgColorHex}
                          onChange={e => setCustomBgColor(e.target.value)}
                          placeholder="#1a1a2e"
                          className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary"
                        />
                        <div
                          className="w-8 h-8 rounded-lg border border-white/20 shrink-0"
                          style={{ backgroundColor: customBgColor || bgColorHex }}
                        />
                      </div>
                    </div>
                  )}

                  {bgType === "image" && (
                    <input
                      type="url"
                      value={bgUrl}
                      onChange={e => setBgUrl(e.target.value)}
                      placeholder="https://image-url.jpg"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-primary placeholder:text-white/30"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Column */}
        <div className="space-y-6">
          <div className="glass-panel-heavy rounded-2xl p-6">
            <h3 className="text-base font-semibold text-white mb-4">1. Select Avatar</h3>
            {loadingAvatars ? (
              <div className="h-12 bg-white/5 rounded-xl animate-pulse" />
            ) : readyAvatars.length === 0 ? (
              <div className="space-y-2">
                <div className="text-sm text-red-400 p-3 bg-red-400/10 rounded-xl border border-red-400/20">
                  No usable avatars found.
                </div>
                {avatars && avatars.length > 0 && (
                  <p className="text-xs text-amber-400/80 px-1">
                    Existing avatars have no source image. Recreate them in Capture Studio.
                  </p>
                )}
                {(!avatars || avatars.length === 0) && (
                  <p className="text-xs text-white/40 px-1">Go to Capture Studio to create one.</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {readyAvatars.map(av => (
                  <button
                    key={av.id}
                    type="button"
                    onClick={() => setSelectedAvatar(av.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      selectedAvatar === av.id
                        ? "bg-primary/10 border-primary shadow-md shadow-primary/10"
                        : "bg-black/40 border-white/5 hover:border-white/20"
                    }`}
                  >
                    <img
                      src={av.thumbnailUrl?.startsWith('s3://') || !av.thumbnailUrl
                        ? `${import.meta.env.BASE_URL}images/avatar-placeholder.png`
                        : av.thumbnailUrl}
                      className="w-10 h-10 rounded-lg object-cover bg-black shrink-0"
                      alt=""
                    />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-medium text-white/90 truncate">{av.name}</p>
                      {av.pose && (
                        <p className="text-[10px] text-primary/70 uppercase tracking-wide font-semibold capitalize">{av.pose}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="glass-panel-heavy rounded-2xl p-6">
            <h3 className="text-base font-semibold text-white mb-4">2. Language</h3>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary appearance-none cursor-pointer"
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code} className="bg-zinc-900">{l.name}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handlePreviewAudio}
            disabled={previewLoading || !script.trim() || !selectedAvatar}
            className="w-full py-3 rounded-xl border border-primary/30 text-primary font-semibold hover:bg-primary/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Volume2 className="w-4 h-4" />
            {previewLoading ? "Generating audio..." : "Preview Voice"}
          </button>

          {previewAudioUrl && (
            <audio
              key={previewAudioUrl}
              controls
              autoPlay
              className="w-full rounded-xl"
              src={previewAudioUrl}
            />
          )}

          <button
            type="submit"
            disabled={generateVideo.isPending || !selectedAvatar || !script.trim() || readyAvatars.length === 0}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-bold text-lg hover:shadow-lg hover:shadow-primary/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 hover:-translate-y-0.5"
          >
            <Sparkles className="w-5 h-5" />
            {generateVideo.isPending ? "Initializing..." : "Generate Video"}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
