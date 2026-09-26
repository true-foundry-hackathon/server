import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

const BAR_COUNT = 5;

export function TalkToVoxIsland({
  isActive,
  isSpeaking,
  callState,
  label,
  subLabel,
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

  return (
    <div
      className={cn(
        "no-drag absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-3 rounded-3xl border border-white/15 bg-ink/80 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-md transition-[width,padding] duration-200 ease-out",
        expanded ? "w-[19rem] px-5 py-4" : "w-auto px-4 py-2.5",
      )}
    >
      <div className="flex w-full items-center gap-3">
        <button
          type="button"
          onClick={onToggleCall}
          title={isActive ? "End call" : "Talk to Vox"}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full transition",
            isActive
              ? "bg-ember-hush text-coral-pulse hover:bg-ember-hush/90"
              : "bg-graphite text-pure-white hover:bg-obsidian",
          )}
        >
          {isActive || connecting ? (
            <MicOff className="size-4" />
          ) : (
            <Mic className="size-4" />
          )}
        </button>

        {expanded ? (
          <div className="flex h-9 min-w-0 flex-1 items-center justify-center gap-[3px]">
            {Array.from({ length: BAR_COUNT }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "vox-wave-bar w-[3px] rounded-full bg-coral-pulse/80",
                  isSpeaking && "vox-wave-bar--active",
                )}
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggleCall}
            className="text-[13px] font-medium text-pure-white"
          >
            Talk to Vox
          </button>
        )}
      </div>

      {expanded ? (
        <div className="w-full text-center">
          <p className="text-[12px] text-ash">{label}</p>
          <p className="mt-0.5 text-[11px] text-smoke">{subLabel}</p>
          {callError ? (
            <p className="mt-1.5 text-[11px] text-coral-pulse">{callError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
