import { useState } from "react";
import { Link } from "wouter";
import { useListAvatars, useListVideos, useDeleteAvatar } from "@workspace/api-client-react";
import { useApiAuth } from "@/hooks/use-api-auth";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Video as VideoIcon, Activity, Mic, ArrowRight, User, Trash2, X, AlertTriangle } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const auth = useApiAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: avatars, isLoading: loadingAvatars } = useListAvatars({ request: auth });
  const { data: videos, isLoading: loadingVideos } = useListVideos({ request: auth });
  const deleteAvatarMutation = useDeleteAvatar({ request: auth });

  const handleDelete = async (id: string) => {
    try {
      await deleteAvatarMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["listAvatars"] });
      toast({ title: "Avatar deleted" });
    } catch {
      toast({ title: "Failed to delete avatar", variant: "destructive" });
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const recentVideos = videos?.slice(0, 4) || [];
  const readyVideos = videos?.filter(v => v.status === "ready") || [];
  const confirmDeleteTarget = avatars?.find(a => a.id === confirmDeleteId);
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-10"
    >
      <header>
        <h1 className="text-4xl font-bold text-white mb-2">Welcome Back</h1>
        <p className="text-muted-foreground text-lg">Manage your digital clones and generated content.</p>
      </header>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-2xl hover-glow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-primary/20 rounded-xl text-primary">
              <UserIcon className="w-6 h-6" />
            </div>
            <span className="text-3xl font-display font-bold text-white">
              {loadingAvatars ? "-" : avatars?.length || 0}
            </span>
          </div>
          <h3 className="font-medium text-white">Active Avatars</h3>
          <p className="text-sm text-muted-foreground mt-1">Digital clones ready to speak.</p>
        </div>
        
        <div className="glass-panel p-6 rounded-2xl hover-glow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-accent/20 rounded-xl text-accent">
              <VideoIcon className="w-6 h-6" />
            </div>
            <span className="text-3xl font-display font-bold text-white">
              {loadingVideos ? "-" : readyVideos.length}
            </span>
          </div>
          <h3 className="font-medium text-white">Videos Generated</h3>
          <p className="text-sm text-muted-foreground mt-1">Total completed rendering.</p>
        </div>
        
        <div className="glass-panel p-6 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 border-primary/20">
          <h3 className="font-semibold text-white mb-2">Quick Actions</h3>
          <div className="space-y-2">
            <Link href="/capture" className="flex items-center gap-2 text-sm text-primary hover:text-primary-foreground transition-colors p-2 rounded-lg hover:bg-primary/20">
              <Mic className="w-4 h-4" /> Create new clone
            </Link>
            <Link href="/create-video" className="flex items-center gap-2 text-sm text-accent hover:text-accent-foreground transition-colors p-2 rounded-lg hover:bg-accent/20">
              <VideoIcon className="w-4 h-4" /> Draft new script
            </Link>
          </div>
        </div>
      </div>

      {/* Avatars Section */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" /> Your Avatars
          </h2>
        </div>
        
        {loadingAvatars ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
            {[1, 2, 3].map(i => <div key={i} className="h-48 bg-white/5 rounded-2xl"></div>)}
          </div>
        ) : avatars?.length === 0 ? (
          <div className="glass-panel rounded-3xl p-10 text-center border-dashed border-2 border-white/10">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserIcon className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">No avatars yet</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">Create your first digital clone using your webcam and microphone to get started.</p>
            <Link href="/capture" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition-all shadow-lg shadow-primary/25 hover:-translate-y-1">
              <Plus className="w-5 h-5" /> Capture Studio
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-6">
            {avatars?.map(avatar => (
              <div key={avatar.id} className="group relative aspect-[3/4] rounded-2xl overflow-hidden glass-panel hover:border-primary/50 transition-all hover:-translate-y-1">
                {/* Card body — navigates to detail */}
                <Link href={`/avatars/${avatar.id}`} className="absolute inset-0 block">
                  <img 
                    src={avatar.thumbnailUrl?.startsWith('s3://') || !avatar.thumbnailUrl ? `${import.meta.env.BASE_URL}images/avatar-placeholder.png` : avatar.thumbnailUrl}
                    alt={avatar.name}
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="font-bold text-white text-lg">{avatar.name}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${avatar.hasVoice && avatar.voiceStatus === 'ready' ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                      <span className="text-xs text-white/70">{avatar.hasVoice && avatar.voiceStatus === 'ready' ? 'Voice Ready' : 'Processing Voice'}</span>
                      {avatar.pose && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/30 text-primary/90 uppercase tracking-wide capitalize">
                          {avatar.pose}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>

                {/* Delete button — appears on hover */}
                <button
                  onClick={(e) => { e.preventDefault(); setConfirmDeleteId(avatar.id); }}
                  className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-background/70 backdrop-blur text-white/50 hover:text-red-400 hover:bg-red-400/20 opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete avatar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

        )}
      </section>

      {/* Recent Videos */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Recent Videos</h2>
          <Link href="/videos" className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {loadingVideos ? (
          <div className="h-32 glass-panel rounded-2xl animate-pulse"></div>
        ) : recentVideos.length === 0 ? (
          <div className="glass-panel p-8 rounded-2xl text-center">
            <p className="text-muted-foreground">You haven't generated any videos yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {recentVideos.map(video => (
              <div key={video.id} className="glass-panel rounded-xl overflow-hidden group">
                <div className="aspect-video bg-black relative">
                  {video.status === 'ready' && video.videoUrl ? (
                    <video src={video.videoUrl} className="w-full h-full object-cover" muted loop onMouseEnter={e => e.currentTarget.play()} onMouseLeave={e => e.currentTarget.pause()} />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/5">
                      <VideoIcon className="w-8 h-8 text-white/20" />
                    </div>
                  )}
                  <div className="absolute top-2 right-2 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-background/80 backdrop-blur text-white">
                    {video.status}
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-sm text-white/90 line-clamp-2 leading-snug">{video.script}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="capitalize">{video.emotion}</span>
                    <span>{formatDuration(video.duration)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {confirmDeleteId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setConfirmDeleteId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel-heavy rounded-2xl p-8 max-w-sm w-full border border-white/10 shadow-2xl text-center"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-5">
                <AlertTriangle className="w-7 h-7 text-red-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Delete Avatar?</h3>
              <p className="text-muted-foreground text-sm mb-6">
                <span className="text-white font-medium">"{confirmDeleteTarget?.name}"</span> and all its associated data will be permanently removed. This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/70 hover:bg-white/5 transition-colors flex items-center justify-center gap-2 font-medium"
                >
                  <X className="w-4 h-4" /> Cancel
                </button>
                <button
                  onClick={() => handleDelete(confirmDeleteId)}
                  disabled={deleteAvatarMutation.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {deleteAvatarMutation.isPending
                    ? <span className="animate-pulse">Deleting…</span>
                    : <><Trash2 className="w-4 h-4" /> Delete</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function UserIcon(props: Parameters<typeof User>[0]) {
  return <User {...props} />;
}
