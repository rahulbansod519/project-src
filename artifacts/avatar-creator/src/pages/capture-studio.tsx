import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useApiAuth } from "@/hooks/use-api-auth";
import { useCreateAvatar, useUploadVoiceSample } from "@workspace/api-client-react";
import { useCamera } from "@/hooks/use-camera";
import { useMediaRecorder } from "@/hooks/use-media-recorder";
import { useFaceMesh } from "@/hooks/use-face-mesh";
import { Camera, Mic, CheckCircle2, ChevronRight, RefreshCw, AlertCircle, Loader2, Key, ScanFace, PersonStanding, Armchair, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSettingsStore } from "@/lib/store";

const SCRIPT_TO_READ = "Hi, I am creating my digital clone. I am reading this sentence in my natural speaking voice so the AI can analyze my tone, pitch, and cadence. This sample will be used to generate my authentic voice clone.";

type Pose = "bust" | "half-body" | "sitting" | "standing";

const POSES: {
  id: Pose;
  label: string;
  description: string;
  icon: React.ElementType;
  guideStyle: { top: string; left: string; width: string; height: string; rx: string; ry: string };
} [] = [
  {
    id: "bust",
    label: "Close-up",
    description: "Head & shoulders",
    icon: ScanFace,
    guideStyle: { top: "8%", left: "20%", width: "60%", height: "82%", rx: "50%", ry: "50%" },
  },
  {
    id: "half-body",
    label: "Half-body",
    description: "Torso & face",
    icon: Users,
    guideStyle: { top: "4%", left: "22%", width: "56%", height: "90%", rx: "45%", ry: "45%" },
  },
  {
    id: "sitting",
    label: "Sitting",
    description: "Seated pose",
    icon: Armchair,
    guideStyle: { top: "2%", left: "18%", width: "64%", height: "94%", rx: "40%", ry: "40%" },
  },
  {
    id: "standing",
    label: "Standing",
    description: "Full upright",
    icon: PersonStanding,
    guideStyle: { top: "1%", left: "25%", width: "50%", height: "97%", rx: "30%", ry: "30%" },
  },
];

function PoseGuideOverlay({ pose }: { pose: Pose }) {
  const p = POSES.find(p => p.id === pose)!;
  const g = p.guideStyle;
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <mask id="pose-mask">
          <rect width="100" height="100" fill="white" />
          <ellipse
            cx={parseFloat(g.left) + parseFloat(g.width) / 2}
            cy={parseFloat(g.top) + parseFloat(g.height) / 2}
            rx={parseFloat(g.width) / 2}
            ry={parseFloat(g.height) / 2}
            fill="black"
          />
        </mask>
      </defs>
      <rect width="100" height="100" fill="rgba(0,0,0,0.45)" mask="url(#pose-mask)" />
      <ellipse
        cx={parseFloat(g.left) + parseFloat(g.width) / 2}
        cy={parseFloat(g.top) + parseFloat(g.height) / 2}
        rx={parseFloat(g.width) / 2}
        ry={parseFloat(g.height) / 2}
        fill="none"
        stroke="rgba(139,92,246,0.9)"
        strokeWidth="0.5"
        strokeDasharray="2 1"
      />
    </svg>
  );
}

export default function CaptureStudio() {
  const [step, setStep] = useState(0);
  const [pose, setPose] = useState<Pose>("bust");
  const [avatarName, setAvatarName] = useState("");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const auth = useApiAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { didApiKey } = useSettingsStore();

  const { videoRef, startCamera, stopCamera, captureFrame, error: cameraError } = useCamera();
  const {
    isRecording, startRecording, stopRecording, resetRecording, audioBase64, duration, canvasRef, error: micError
  } = useMediaRecorder();

  const createAvatar = useCreateAvatar({ request: auth });
  const uploadVoice = useUploadVoiceSample({ request: auth });

  const faceMeshEnabled = step === 1 && !capturedImage && !cameraError;
  useFaceMesh(videoRef, overlayCanvasRef, faceMeshEnabled);

  useEffect(() => {
    if (step === 1 && !capturedImage) startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [step, startCamera, stopCamera, capturedImage]);

  const handleCapturePhoto = (): void => {
    const img = captureFrame();
    if (img) {
      setCapturedImage(img);
      stopCamera();
    }
  };

  const handleNextStep = (): void => {
    if (step === 1 && !capturedImage) {
      toast({ title: "Please capture a photo first", variant: "destructive" });
      return;
    }
    if (step === 2 && !audioBase64) {
      toast({ title: "Please record a voice sample", variant: "destructive" });
      return;
    }
    setStep(s => s + 1);
  };

  const handleSubmit = async (): Promise<void> => {
    if (!avatarName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!capturedImage || !audioBase64) return;

    try {
      const avatar = await createAvatar.mutateAsync({
        data: { name: avatarName, imageBase64: capturedImage, pose }
      });

      await uploadVoice.mutateAsync({
        id: avatar.id,
        data: { audioBase64, audioName: `${avatarName}'s Voice` }
      });

      toast({ title: "Digital Clone Created!", description: "Your avatar is processing." });
      setLocation(`/avatars/${avatar.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      toast({ title: "Creation Failed", description: message, variant: "destructive" });
    }
  };


  if (false) {
    return (
      <div />
    );
  }

  const STEP_LABELS = [
    { num: 0, label: "Pose", icon: ScanFace },
    { num: 1, label: "Face Capture", icon: Camera },
    { num: 2, label: "Voice Sample", icon: Mic },
    { num: 3, label: "Finalize", icon: CheckCircle2 },
  ];

  return (
    <div className="max-w-4xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-white">Capture Studio</h1>
        <p className="text-muted-foreground mt-2">Follow the steps to digitize your appearance and voice.</p>

        {/* Step progress */}
        <div className="flex items-center gap-3 mt-8 overflow-x-auto pb-1">
          {STEP_LABELS.map((s, i) => (
            <div key={s.num} className="flex items-center gap-3 flex-1 min-w-0">
              <div className={`flex flex-col items-center gap-1.5 shrink-0 ${step >= s.num ? 'opacity-100' : 'opacity-40'}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors ${step >= s.num ? 'border-primary bg-primary/20 text-primary' : 'border-white/10 text-white/50'}`}>
                  <s.icon className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">{s.label}</span>
              </div>
              {i < STEP_LABELS.length - 1 && <div className={`flex-1 h-0.5 rounded ${step > s.num ? 'bg-primary' : 'bg-white/10'}`} />}
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel-heavy rounded-3xl p-6 md:p-10 min-h-[500px] relative overflow-hidden">
        <AnimatePresence mode="wait">

          {/* STEP 0: POSE SELECTION */}
          {step === 0 && (
            <motion.div
              key="step0"
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="flex flex-col items-center"
            >
              <h2 className="text-2xl font-bold text-white mb-2">Choose your capture pose</h2>
              <p className="text-sm text-muted-foreground mb-8 text-center max-w-md">
                Select how you'd like to appear in your avatar. Position yourself accordingly before capturing.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-2xl mb-10">
                {POSES.map(p => {
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPose(p.id)}
                      className={`flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all ${
                        pose === p.id
                          ? "border-primary bg-primary/15 shadow-lg shadow-primary/20"
                          : "border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10"
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${pose === p.id ? 'bg-primary/20 text-primary' : 'bg-white/10 text-white/60'}`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div className="text-center">
                        <p className={`font-semibold text-sm ${pose === p.id ? 'text-white' : 'text-white/70'}`}>{p.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{p.description}</p>
                      </div>
                      {pose === p.id && (
                        <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                          <CheckCircle2 className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setStep(1)}
                className="px-10 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition-all flex items-center gap-2 shadow-lg shadow-primary/25"
              >
                Continue to Capture <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* STEP 1: FACE CAPTURE */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="flex flex-col items-center h-full"
            >
              <h2 className="text-2xl font-bold text-white mb-1">Look directly at the camera</h2>
              <p className="text-sm text-muted-foreground mb-2">
                {POSES.find(p => p.id === pose)?.description} — fit yourself within the guide
              </p>
              <div className="flex items-center gap-2 mb-5">
                {POSES.find(p => p.id === pose) && (() => {
                  const pData = POSES.find(pp => pp.id === pose)!;
                  const Icon = pData.icon;
                  return (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-semibold">
                      <Icon className="w-3.5 h-3.5" /> {pData.label}
                    </span>
                  );
                })()}
              </div>

              <div className="relative w-full max-w-lg aspect-video bg-black rounded-2xl overflow-hidden border-2 border-white/10 shadow-2xl">
                {cameraError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 p-6 text-center">
                    <AlertCircle className="w-10 h-10 mb-2" />
                    <p>{cameraError}</p>
                    <p className="text-sm mt-2">Please allow camera permissions.</p>
                  </div>
                ) : capturedImage ? (
                  <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
                ) : (
                  <>
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
                    <PoseGuideOverlay pose={pose} />
                    <canvas
                      ref={overlayCanvasRef}
                      className="absolute inset-0 w-full h-full pointer-events-none"
                    />
                  </>
                )}
              </div>

              {!capturedImage && !cameraError && (
                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-primary">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  Align with the guide, then capture
                </div>
              )}

              <div className="mt-6 flex gap-4">
                <button onClick={() => setStep(0)} className="px-6 py-3 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-colors">
                  Back
                </button>
                {capturedImage ? (
                  <>
                    <button onClick={() => setCapturedImage(null)} className="px-6 py-3 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-colors flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" /> Retake
                    </button>
                    <button onClick={handleNextStep} className="px-8 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition-all flex items-center gap-2 shadow-lg shadow-primary/25">
                      Continue to Voice <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleCapturePhoto}
                    disabled={!!cameraError}
                    className="px-10 py-4 rounded-full font-bold transition-transform flex items-center gap-2 bg-white text-black hover:bg-gray-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Camera className="w-5 h-5" />
                    Capture Photo
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* STEP 2: VOICE SAMPLE */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="flex flex-col items-center h-full"
            >
              <h2 className="text-2xl font-bold text-white mb-2">Read the script below</h2>
              <p className="text-muted-foreground mb-8">Record at least 15 seconds in a quiet environment.</p>

              <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-8 mb-8 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 bg-primary h-full"></div>
                <p className="text-xl md:text-2xl font-serif text-white/90 leading-relaxed italic text-center">
                  "{SCRIPT_TO_READ}"
                </p>
              </div>

              {micError && <p className="text-red-400 mb-4">{micError}</p>}

              <div className="w-full max-w-md h-24 bg-black/50 rounded-xl mb-8 relative border border-white/5 overflow-hidden flex items-center justify-center">
                {!audioBase64 ? (
                  <canvas ref={canvasRef} className="w-full h-full opacity-80" />
                ) : (
                  <div className="flex items-center gap-3 text-green-400 font-medium">
                    <CheckCircle2 className="w-6 h-6" /> Audio captured successfully
                  </div>
                )}
                {isRecording && (
                  <div className="absolute top-2 right-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs font-mono text-white">0:{duration.toString().padStart(2, '0')}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <button onClick={() => setStep(1)} className="px-6 py-3 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-colors">
                  Back
                </button>

                {audioBase64 ? (
                  <>
                    <button onClick={resetRecording} className="px-6 py-3 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-colors">
                      Retake
                    </button>
                    <button onClick={handleNextStep} className="px-8 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition-all flex items-center gap-2 shadow-lg shadow-primary/25">
                      Review <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                ) : isRecording ? (
                  <button onClick={stopRecording} className="px-10 py-4 rounded-full bg-red-500 text-white font-bold hover:bg-red-600 transition-transform animate-pulse flex items-center gap-2">
                    <div className="w-4 h-4 bg-white rounded-sm" /> Stop Recording
                  </button>
                ) : (
                  <button onClick={startRecording} className="px-10 py-4 rounded-full bg-white text-black font-bold hover:bg-gray-200 transition-transform hover:scale-105 active:scale-95 flex items-center gap-2">
                    <Mic className="w-5 h-5" /> Start Recording
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* STEP 3: FINALIZE */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="flex flex-col items-center h-full max-w-md mx-auto"
            >
              <h2 className="text-2xl font-bold text-white mb-8">Name your clone</h2>

              <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-primary/30 mb-2 shadow-xl shadow-primary/20 relative">
                {capturedImage && <img src={capturedImage} alt="Preview" className="w-full h-full object-cover -scale-x-100" />}
              </div>
              {/* Pose badge below preview */}
              {(() => {
                const pData = POSES.find(pp => pp.id === pose);
                if (!pData) return null;
                const Icon = pData.icon;
                return (
                  <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-semibold mb-6">
                    <Icon className="w-3.5 h-3.5" /> {pData.label}
                  </span>
                );
              })()}

              <div className="w-full space-y-2 mb-8">
                <label className="text-sm font-medium text-muted-foreground">Avatar Name</label>
                <input
                  type="text"
                  value={avatarName}
                  onChange={e => setAvatarName(e.target.value)}
                  placeholder="e.g. Professional AI Me"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-4 text-white text-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  autoFocus
                />
              </div>

              <div className="flex gap-4 w-full">
                <button
                  onClick={() => setStep(2)}
                  disabled={createAvatar.isPending || uploadVoice.isPending}
                  className="px-6 py-4 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!avatarName.trim() || createAvatar.isPending || uploadVoice.isPending}
                  className="flex-1 py-4 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-bold hover:shadow-lg hover:shadow-primary/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(createAvatar.isPending || uploadVoice.isPending) ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Creating Magic...</>
                  ) : (
                    <><CheckCircle2 className="w-5 h-5" /> Generate Digital Clone</>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
