import { VoxLogo, type VoxOrbVisualState } from "@/components/vox-logo";
import { cn } from "@/lib/utils";

export function AgentPane({
  isActive,
  callState,
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
  const orbState: VoxOrbVisualState = callError
    ? "error"
    : isActive
      ? "active"
      : connecting
        ? "connecting"
        : "idle";

  const buttonText = callError
    ? "Error connecting"
    : isActive
      ? "End call"
      : connecting
        ? "Connecting…"
        : "Talk to Vox";

  return (
    <div className="pointer-events-none flex h-full w-full flex-col items-center justify-end pb-8">
      <button
        type="button"
        onClick={onToggleCall}
        className={cn(
          "pointer-events-auto group relative flex items-center gap-2.5 rounded-full border px-5 py-2.5 shadow-2xl backdrop-blur-xl transition active:scale-95",
          isActive
            ? "border-coral-pulse/40 bg-[#160d0f]/90 text-coral-pulse shadow-[0_0_24px_rgba(255,99,99,0.25)] hover:bg-[#1a0f12]"
            : "border-white/15 bg-[#0a0b0e]/85 text-pure-white hover:border-white/30 hover:bg-[#121318]/95 shadow-[0_8px_30px_rgba(0,0,0,0.6)]",
        )}
      >
        <VoxLogo animated size={20} state={orbState} className="shrink-0" />
        <span className="text-[13px] font-medium tracking-wide">
          {buttonText}
        </span>
      </button>
    </div>
  );
}
