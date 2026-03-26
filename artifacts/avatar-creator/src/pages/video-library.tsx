import { useEffect } from "react";
import { useListVideos, useDeleteVideo, useGetVideo } from "@workspace/api-client-react";
import type { Video } from "@workspace/api-client-react";

import { useApiAuth } from "@/hooks/use-api-auth";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Download, Trash2, Video as VideoIcon, RefreshCw, AlertCircle, Clapperboard } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function VideoCard({ video: initialVideo }: { video: Video }) {
  const auth = useApiAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteVideo = useDeleteVideo({ request: auth });

  const { data: polledVideo } = useGetVideo(initialVideo.id, { request: auth });

  const displayVideo = polledVideo ?? initialVideo;

  const handleDelete = async (): Promise<void> => {
    if (!confirm("Delete this video?")) return;
    try {
      await deleteVideo.mutateAsync({ id: displayVideo.id });
      await queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      toast({ title: "Video deleted" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete";
      toast({ title: "Error deleting video", description: message, variant: "destructive" });
    }
  };

  const statusColors: Record<string, string> = {
    ready: "bg-green-500/20 text-green-400 border-green-500/30",
    processing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <div className="glass-panel rounded-2xl overflow-hidden flex flex-col group transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50 hover:border-white/20">
      <div className="aspect-video bg-black relative">
        {displayVideo.status === "ready" && displayVideo.videoUrl ? (
          <video
            src={displayVideo.videoUrl}
            className="w-full h-full object-cover"
            controls
            preload="metadata"
            poster={displayVideo.thumbnailUrl ?? undefined}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center flex-col gap-3 bg-gradient-to-br from-black to-zinc-900 p-4">
            {displayVideo.status === "failed" ? (
              <>
                <AlertCircle className="w-10 h-10 text-red-500/70" />
                {displayVideo.errorMessage && (
                  <p className="text-xs text-red-400/80 text-center leading-relaxed line-clamp-3">
                    {displayVideo.errorMessage}
                  </p>
                )}
              </>
            ) : (
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <RefreshCw className="w-4 h-4 text-primary animate-pulse" />
                </div>
              </div>
            )}
          </div>
        )}

        <div
          className={`absolute top-3 left-3 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border backdrop-blur-md ${statusColors[displayVideo.status] ?? ""}`}
        >
          {displayVideo.status}
        </div>

        <button
          onClick={handleDelete}
          className="absolute top-3 right-3 p-2 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg text-white/70 hover:text-red-400 hover:bg-red-400/20 transition-all opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 flex flex-col flex-1">
        <p className="text-sm text-white/90 line-clamp-3 leading-relaxed italic mb-4">
          "{displayVideo.script}"
        </p>

        <div className="mt-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="capitalize px-2 py-1 bg-white/5 rounded-md border border-white/5">{displayVideo.emotion}</span>
            {displayVideo.duration != null && <span>{formatDuration(displayVideo.duration)}</span>}
          </div>

          {displayVideo.status === "ready" && displayVideo.videoUrl && (
            <a
              href={displayVideo.videoUrl}
              download={`video-${displayVideo.id}.mp4`}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white transition-colors border border-primary/20"
              title="Download MP4"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VideoLibrary() {
  const auth = useApiAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: videos, isLoading } = useListVideos({ request: auth });

  // Poll every 5s when any video is still in-progress
  const hasInProgress =
    videos?.some(v => v.status === "pending" || v.status === "processing") ?? false;

  useEffect(() => {
    if (!hasInProgress) return;
    const timer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    }, 5000);
    return () => clearInterval(timer);
  }, [hasInProgress, queryClient]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Video Library</h1>
          <p className="text-muted-foreground">All generated content across your avatars.</p>
        </div>
        {videos && videos.length > 0 && (
          <button
            onClick={() => setLocation("/create-video")}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition-colors"
          >
            <Clapperboard className="w-4 h-4" /> New Video
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="aspect-[4/5] glass-panel rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : !videos || videos.length === 0 ? (
        <div className="glass-panel-heavy rounded-3xl p-16 text-center border-dashed border-2 border-white/10 max-w-2xl mx-auto mt-12">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <VideoIcon className="w-10 h-10 text-primary" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-3">No videos yet</h3>
          <p className="text-muted-foreground text-lg mb-8">Your rendered videos will appear here.</p>
          <button
            onClick={() => setLocation("/create-video")}
            className="px-8 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition-colors"
          >
            Create your first video
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {videos.map(video => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
