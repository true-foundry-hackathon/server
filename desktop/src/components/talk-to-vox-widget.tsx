import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function TalkToVoxWidget({
  isActive,
  callState,
  label,
  callError,
  onToggleCall,
}: {
  isActive: boolean;
  isSpeaking: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  onToggleCall: () => void;
}) {
  const connecting = callState === "connecting";
  const expanded = isActive || connecting;
  const status = callError || (expanded ? label : undefined);

  return (
    <button
      type="button"
      onClick={onToggleCall}
      title={isActive ? "End call" : "Talk to Vox"}
      className="pointer-events-auto relative flex w-32 shrink-0 flex-col items-center justify-center gap-2 self-stretch overflow-hidden rounded-lg border border-coral-pulse/10 bg-black/70 px-3 py-3 text-center shadow-[0_12px_28px_rgba(0,0,0,0.5)] backdrop-blur-md transition hover:border-coral-pulse/20"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,99,99,0.14)_0%,transparent_55%)]"
      />
      <span
        className={cn(
          "relative flex size-9 items-center justify-center rounded-full transition",
          isActive ? "bg-ember-hush text-coral-pulse" : "bg-white/8 text-pure-white",
        )}
      >
        {isActive || connecting ? (
          <MicOff className="size-4" />
        ) : (
          <Mic className="size-4" />
        )}
      </span>
      <span className="relative text-[12.5px] font-medium text-pure-white">
        Talk to Vox
      </span>
      {status ? (
        <span
          className={cn(
            "relative line-clamp-2 text-[10px] leading-snug",
            callError ? "text-coral-pulse" : "text-white/50",
          )}
        >
          {status}
        </span>
      ) : null}
    </button>
  );
}
