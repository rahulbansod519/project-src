import { useState, useEffect } from "react";
import { useSettingsStore } from "@/lib/store";
import { useTestApiKeys } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Key, Save, Server, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function KeyPanel({
  label,
  color,
  placeholder,
  docsUrl,
  docsLabel,
  storedKey,
  description,
  onSave,
  testResult,
  isTesting,
}: {
  label: string;
  color: string;
  placeholder: string;
  docsUrl: string;
  docsLabel: string;
  storedKey: string;
  description: string;
  onSave: (key: string) => Promise<{ valid: boolean; message: string } | null>;
  testResult: { valid: boolean; message: string } | null;
  isTesting: boolean;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(storedKey);
  }, [storedKey]);

  const isDirty = value !== storedKey;

  const borderFocus =
    color === "blue"
      ? "focus:border-blue-400 focus:ring-blue-400"
      : "focus:border-purple-400 focus:ring-purple-400";
  const labelColor = color === "blue" ? "text-blue-400" : "text-purple-400";
  const docColor = color === "blue" ? "text-blue-400" : "text-purple-400";

  return (
    <div className="glass-panel-heavy rounded-3xl p-8 border border-white/10 space-y-5 relative overflow-hidden">
      <div className="absolute -top-40 -right-40 w-72 h-72 bg-primary/8 rounded-full blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between relative z-10">
        <label className={`text-sm font-semibold text-white flex items-center gap-2`}>
          <Server className={`w-4 h-4 ${labelColor}`} /> {label}
        </label>
        <a href={docsUrl} target="_blank" rel="noreferrer" className={`text-xs ${docColor} hover:underline`}>
          {docsLabel}
        </a>
      </div>

      <p className="text-sm text-muted-foreground relative z-10">{description}</p>

      <div className="relative z-10">
        <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-12 text-white font-mono text-sm transition-all focus:ring-1 ${borderFocus}`}
        />
        {testResult !== null && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            {testResult.valid ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500" />
            )}
          </div>
        )}
      </div>

      {testResult?.message && (
        <p className={`text-xs relative z-10 ${testResult.valid ? "text-green-400" : "text-red-400"}`}>
          {testResult.message}
        </p>
      )}

      <div className="relative z-10">
        <button
          onClick={() => onSave(value)}
          disabled={isTesting || !value}
          className="px-6 py-2.5 rounded-xl bg-white text-black font-bold text-sm hover:bg-gray-200 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isTesting ? (
            <span className="animate-pulse">Verifying...</span>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {isDirty ? "Save & Test" : "Re-test"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  const store = useSettingsStore();
  const { toast } = useToast();

  const [didResult, setDidResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [elResult, setElResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [testingDid, setTestingDid] = useState(false);
  const [testingEl, setTestingEl] = useState(false);

  const testMutation = useTestApiKeys();

  const handleSaveDid = async (key: string) => {
    store.setDidApiKey(key);
    setTestingDid(true);
    setDidResult(null);
    try {
      const res = await testMutation.mutateAsync({ data: { didApiKey: key, elevenlabsApiKey: "" } });
      setDidResult(res.did);
      toast({
        title: res.did.valid ? "D-ID key saved" : "D-ID key invalid",
        description: res.did.message,
        variant: res.did.valid ? "default" : "destructive",
      });
    } catch {
      toast({ title: "Connection failed", description: "Could not reach D-ID.", variant: "destructive" });
    } finally {
      setTestingDid(false);
    }
    return null;
  };

  const handleSaveEl = async (key: string) => {
    store.setElevenlabsApiKey(key);
    setTestingEl(true);
    setElResult(null);
    try {
      const res = await testMutation.mutateAsync({ data: { didApiKey: "", elevenlabsApiKey: key } });
      setElResult(res.elevenlabs);
      toast({
        title: res.elevenlabs.valid ? "ElevenLabs key saved" : "ElevenLabs key invalid",
        description: res.elevenlabs.message,
        variant: res.elevenlabs.valid ? "default" : "destructive",
      });
    } catch {
      toast({ title: "Connection failed", description: "Could not reach ElevenLabs.", variant: "destructive" });
    } finally {
      setTestingEl(false);
    }
    return null;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-white mb-2">Platform Settings</h1>
        <p className="text-muted-foreground">Configure your AI service providers. Keys are stored locally in your browser only.</p>
      </div>

      <div className="flex items-start gap-4 p-4 rounded-xl bg-primary/10 border border-primary/20">
        <ShieldAlert className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-semibold text-white mb-1">Privacy Notice</h4>
          <p className="text-sm text-white/70 leading-relaxed">
            Your API keys are never stored on our servers. They live in your browser's local storage and are sent directly
            via request headers to proxy calls to D-ID and ElevenLabs.
          </p>
        </div>
      </div>

      <KeyPanel
        label="D-ID API Key"
        color="blue"
        placeholder="Basic YWJj... or Bearer xyz..."
        docsUrl="https://studio.d-id.com/"
        docsLabel="Get Key →"
        storedKey={store.didApiKey}
        description="Required — powers avatar creation (photo upload) and lip-sync video generation."
        onSave={handleSaveDid}
        testResult={didResult}
        isTesting={testingDid}
      />

      <KeyPanel
        label="ElevenLabs API Key"
        color="purple"
        placeholder="sk_..."
        docsUrl="https://elevenlabs.io/"
        docsLabel="Get Key →"
        storedKey={store.elevenlabsApiKey}
        description="Optional — enables custom voice cloning so your avatar speaks in your own voice."
        onSave={handleSaveEl}
        testResult={elResult}
        isTesting={testingEl}
      />
    </motion.div>
  );
}
