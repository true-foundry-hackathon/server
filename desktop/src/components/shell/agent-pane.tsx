import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function AgentPane({
  isActive,
  callState,
  label,
  subLabel,
  callError,
  onToggleCall,
}: {
  isActive: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  onToggleCall: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <TalkPane
        isActive={isActive}
        callState={callState}
        label={label}
        subLabel={subLabel}
        callError={callError}
        onToggleCall={onToggleCall}
      />
      <ActivityLogPane />
    </div>
  );
}

function TalkPane({
  isActive,
  callState,
  label,
  subLabel,
  callError,
  onToggleCall,
}: {
  isActive: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  onToggleCall: () => void;
}) {
  const connecting = callState === "connecting";
  const expanded = isActive || connecting;
  const status = callError || (expanded ? label : subLabel);

  return (
    <button
      type="button"
      onClick={onToggleCall}
      title={isActive ? "End call" : "Talk to Vox"}
      className="pointer-events-auto flex w-[70%] flex-col items-center justify-center gap-2 overflow-hidden p-4 text-center transition"
    >
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full transition",
          isActive
            ? "bg-ember-hush text-coral-pulse"
            : "bg-white/8 text-pure-white",
        )}
      >
        {isActive || connecting ? (
          <MicOff className="size-6" />
        ) : (
          <Mic className="size-6" />
        )}
      </span>
      <span className="text-[14px] font-medium text-pure-white">
        Talk to Vox
      </span>
      {status ? (
        <span
          className={cn(
            "line-clamp-2 max-w-[85%] text-[11px] leading-snug",
            callError ? "text-coral-pulse" : "text-white/50",
          )}
        >
          {status}
        </span>
      ) : null}
    </button>
  );
}

function ActivityLogPane() {
  return (
    <div className="flex w-[30%] shrink-0 flex-col border-l border-white/10 p-4">
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-white/45">
        Activity
      </span>
      <p className="mt-2 text-[11px] text-white/40">
        Agent activity — coming soon
      </p>
    </div>
  );
}
