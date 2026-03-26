import { useRoute, Link } from "wouter";
import { useGetAvatar, useListAvatarVideos, useDeleteAvatar } from "@workspace/api-client-react";
import { useApiAuth } from "@/hooks/use-api-auth";
import { motion } from "framer-motion";
import { formatDuration } from "@/lib/utils";
import { Trash2, Video, ArrowLeft, Loader2, PlayCircle, Clock, Mic } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function AvatarDetail() {
  const [, params] = useRoute("/avatars/:id");
  const id = params?.id || "";
  const auth = useApiAuth();
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: avatar, isLoading: loadingAvatar } = useGetAvatar(id, { request: auth });

  const { data: videos, isLoading: loadingVideos } = useListAvatarVideos(id, { request: auth });
  const deleteAvatar = useDeleteAvatar({ request: auth });

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this avatar? This cannot be undone.")) return;
    setIsDeleting(true);
    try {
      await deleteAvatar.mutateAsync({ id });
      toast({ title: "Avatar deleted" });
      window.location.href = "/";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to delete", description: message, variant: "destructive" });
      setIsDeleting(false);
    }
  };

  if (loadingAvatar) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!avatar) {
    return <div className="text-center py-20 text-white text-xl">Avatar not found</div>;
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-5xl mx-auto space-y-8">
      <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="glass-panel-heavy rounded-3xl overflow-hidden border border-white/10 flex flex-col md:flex-row">
        {/* Left Side: Image */}
        <div className="w-full md:w-1/3 aspect-square md:aspect-auto bg-black relative">
          <img 
            src={avatar.imageUrl || avatar.thumbnailUrl || `${import.meta.env.BASE_URL}images/avatar-placeholder.png`} 
            alt={avatar.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent md:bg-gradient-to-r" />
        </div>

        {/* Right Side: Details */}
        <div className="p-8 md:p-10 flex-1 flex flex-col justify-center relative">
          <div className="flex items-start justify-between mb-2">
            <h1 className="text-4xl font-display font-bold text-white">{avatar.name}</h1>
            <button 
              onClick={handleDelete}
              disabled={isDeleting}
              className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3 mb-8 flex-wrap">
            <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-md bg-white/10 text-white/90 border border-white/10">
              ID: {avatar.id.slice(0, 8)}...
            </span>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${avatar.status === 'ready' ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
              <span className="text-sm font-medium text-white/80 capitalize">{avatar.status}</span>
            </div>
            {avatar.hasVoice && (
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-white/80">{avatar.voiceStatus}</span>
              </div>
            )}
            {avatar.pose && (
              <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-md bg-primary/15 text-primary border border-primary/25 capitalize">
                {avatar.pose}
              </span>
            )}
          </div>

          <div className="mt-auto pt-8 border-t border-white/10 flex flex-wrap gap-4">
            <Link 
              href={`/create-video?avatarId=${avatar.id}`}
              className={`px-8 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                avatar.status === 'ready' 
                  ? 'bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/25 hover:-translate-y-0.5' 
                  : 'bg-white/10 text-white/50 cursor-not-allowed pointer-events-none'
              }`}
            >
              <Video className="w-5 h-5" /> Generate Video
            </Link>
          </div>
        </div>
      </div>

      <div className="pt-8">
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <PlayCircle className="w-6 h-6 text-accent" /> Videos from this clone
        </h2>

        {loadingVideos ? (
          <div className="h-32 glass-panel rounded-2xl animate-pulse" />
        ) : videos?.length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center border-dashed border-2 border-white/5">
            <Video className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-white font-medium">No videos generated yet</p>
            <p className="text-sm text-muted-foreground mt-1">Use the Generate Video button above to create your first script.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {videos?.map(video => (
                <div key={video.id} className="glass-panel rounded-2xl overflow-hidden flex flex-col">
                  <div className="aspect-video bg-black relative">
                    {video.status === 'ready' && video.videoUrl ? (
                      <video src={video.videoUrl} className="w-full h-full object-cover" controls preload="metadata" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center flex-col gap-2">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        <span className="text-xs text-white/70 uppercase tracking-widest">{video.status}</span>
                      </div>
                    )}
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <p className="text-sm text-white/90 line-clamp-3 leading-relaxed flex-1 italic">"{video.script}"</p>
                    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground border-t border-white/5 pt-3">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(video.createdAt).toLocaleDateString()}</span>
                      <span className="capitalize px-2 py-1 bg-white/5 rounded-md text-white/70">{video.emotion}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
