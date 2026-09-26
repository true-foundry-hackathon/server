import { useState, type ReactNode } from "react";
import { MapPin, Satellite } from "lucide-react";
import type { SidebarSectionId } from "@/components/app-sidebar";
import { MapAmbientChrome } from "@/components/map-ambient-chrome";
import { TalkToVoxWidget } from "@/components/talk-to-vox-widget";
import { Button } from "@/components/ui/button";
import { useDeviceLink } from "@/hooks/use-device-link";
import { useMissionMap } from "@/hooks/use-mission-map";
import { openLocationSettings } from "@/lib/tauri";
import { cn } from "@/lib/utils";

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
    location,
    permissionDenied,
    relocate,
  } = useMissionMap();
  const [locPromptDismissed, setLocPromptDismissed] = useState(false);
  const deviceLinkStatus = useDeviceLink();

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

      <div className="no-drag pointer-events-none absolute right-4 top-4 z-20 flex items-stretch gap-2">
        <TalkToVoxWidget
          isActive={isActive}
          isSpeaking={isSpeaking}
          callState={callState}
          label={label}
          subLabel={subLabel}
          callError={callError}
          onToggleCall={onToggleCall}
        />
        <div className="flex flex-col gap-2">
          <HudWidget
            icon={<MapPin className="size-3.5" />}
            label="Location"
            value={location ? "You are at" : locationSource ? "Locating…" : "Unknown"}
            detail={
              location ? (location.city ?? "Unknown area") : undefined
            }
            dotClassName={
              locationSource === "gps"
                ? "bg-emerald-400"
                : locationSource
                  ? "bg-amber-400"
                  : "bg-white/30"
            }
          />
          <HudWidget
            icon={<Satellite className="size-3.5" />}
            label="Desktop Link"
            value={
              deviceLinkStatus === "connected"
                ? "Agent can control this Mac"
                : deviceLinkStatus === "connecting"
                  ? "Reconnecting…"
                  : "Not connected"
            }
            dotClassName={
              deviceLinkStatus === "connected"
                ? "bg-emerald-400"
                : deviceLinkStatus === "connecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-white/30"
            }
          />
        </div>
      </div>

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
    </div>
  );
}

function HudWidget({
  icon,
  label,
  value,
  detail,
  dotClassName,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  dotClassName: string;
}) {
  return (
    <div className="min-w-[13rem] rounded-lg border border-white/10 bg-black/70 px-3 py-2 shadow-[0_12px_28px_rgba(0,0,0,0.5)] backdrop-blur-md">
      <div className="flex items-center gap-1.5 text-white/45">
        {icon}
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em]">
          {label}
        </span>
        <span
          className={cn("ml-auto size-1.5 shrink-0 rounded-full", dotClassName)}
        />
      </div>
      <p className="mt-1 truncate text-[12.5px] text-white/90">{value}</p>
      {detail ? (
        <p className="mt-0.5 font-mono text-[10px] text-white/40">{detail}</p>
      ) : null}
    </div>
  );
}
