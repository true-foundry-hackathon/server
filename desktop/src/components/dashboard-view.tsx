import { useState } from "react";
import type { SidebarSectionId } from "@/components/app-sidebar";
import { MapAmbientChrome } from "@/components/map-ambient-chrome";
import { TalkToVoxIsland } from "@/components/talk-to-vox-island";
import { Button } from "@/components/ui/button";
import { useMissionMap } from "@/hooks/use-mission-map";
import { openLocationSettings } from "@/lib/tauri";

export function DashboardView({
  isActive,
  isSpeaking,
  callState,
  label,
  subLabel,
  callError,
  activeSection,
  onToggleCall,
}: {
  isActive: boolean;
  isSpeaking: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  activeSection: SidebarSectionId | null;
  onToggleCall: () => void;
}) {
  const {
    mapNode,
    mapReady,
    mapError,
    locationSource,
    permissionDenied,
    relocate,
  } = useMissionMap();
  const [locPromptDismissed, setLocPromptDismissed] = useState(false);

  const placeholder =
    activeSection === "lms"
      ? "LMS — whiteboards, notes, and collections coming soon"
      : activeSection === "data"
        ? "Data — finance, travel, and process history coming soon"
        : activeSection === "analytics"
          ? "Analytics — live reports and graphs coming soon"
          : null;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#0b0c0e]">
      <div
        ref={mapNode}
        className="vox-map-host absolute inset-0"
        style={{ background: "#0b0c0e" }}
      />

      <MapAmbientChrome />

      {!mapReady && !mapError ? (
        <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
            Loading map…
          </p>
        </div>
      ) : null}

      {mapError ? (
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-void-black/85 px-8 text-center">
          <p className="max-w-md text-sm text-ash">{mapError}</p>
        </div>
      ) : null}

      {locationSource && locationSource !== "gps" && !locPromptDismissed ? (
        <div className="no-drag absolute bottom-6 left-6 z-30 w-[22rem] rounded-md border border-white/20 bg-black/90 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
            Precise location
          </p>
          <p className="mt-2 text-[13px] leading-snug text-white/90">
            {permissionDenied
              ? "Location access was blocked. Open System Settings to enable it, then try again."
              : "We’re using an approximate city from your network. Enable Location for building-level accuracy."}
          </p>
          <div className="mt-4 flex gap-2">
            {permissionDenied && (
              <Button
                className="h-8 flex-1 rounded-md text-[12px]"
                onClick={() => void openLocationSettings()}
              >
                Open Settings
              </Button>
            )}
            <Button
              className="h-8 flex-1 rounded-md text-[12px]"
              onClick={relocate}
            >
              Try again
            </Button>
            <Button
              variant="secondary"
              className="h-8 rounded-md text-[12px]"
              onClick={() => setLocPromptDismissed(true)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {placeholder ? (
        <div className="no-drag absolute bottom-6 left-6 right-6 z-20 rounded-md border border-white/15 bg-black/80 px-4 py-3 font-mono text-[12px] text-white/70 backdrop-blur-md">
          {placeholder}
        </div>
      ) : null}

      <TalkToVoxIsland
        isActive={isActive}
        isSpeaking={isSpeaking}
        callState={callState}
        label={label}
        subLabel={subLabel}
        callError={callError}
        onToggleCall={onToggleCall}
      />
    </div>
  );
}
