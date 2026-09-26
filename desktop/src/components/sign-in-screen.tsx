import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GoogleIcon } from "@/components/icons";
import { VoxLogo } from "@/components/vox-logo";

export function SignInScreen({
  busy,
  error,
  onSignIn,
}: {
  busy: boolean;
  error: string;
  onSignIn: () => void;
}) {
  return (
    <main
      className="relative flex h-full w-full flex-col overflow-hidden bg-void-black"
      tabIndex={0}
    >
      <div
        className="sign-in-glow pointer-events-none absolute -left-32 -top-36 h-[34rem] w-[34rem]"
        aria-hidden
      />
      <div
        className="sign-in-noise pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="fixed inset-x-0 top-0 z-50 h-3" data-tauri-drag-region />
      <div
        className="relative z-10 flex flex-1 flex-col items-center justify-center gap-7 px-6"
        data-tauri-drag-region
      >
        <VoxLogo size={120} animated state={error ? "error" : "idle"} />
        <div className="flex w-full max-w-105 flex-col items-center text-center">
          <div className="mb-2 inline-flex items-center gap-2">
            <h1 className="text-[32px] font-normal leading-[1.15] text-pure-white">
              Vox
            </h1>
            <Badge
              variant="secondary"
              className="font-mono text-[10px] uppercase tracking-wider"
            >
              Desktop
            </Badge>
          </div>
          <p className="mb-7 max-w-80 text-sm text-ash">
            Talk to your agent, manage tasks, and work with your data — all in
            one place.
          </p>
          <Card className="shadow-key w-full border-0 bg-transparent p-1.5">
            <Button
              className="shadow-btn-lift h-11 w-full gap-2.5"
              disabled={busy}
              onClick={onSignIn}
            >
              <GoogleIcon />
              {busy ? "Waiting for Google…" : "Continue with Google"}
            </Button>
            {error ? (
              <p className="mt-3 text-center text-xs text-coral-pulse">
                {error}
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </main>
  );
}
