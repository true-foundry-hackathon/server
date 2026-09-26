import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { VoxLogo } from "@/components/vox-logo";

// E.164: a leading "+", then 7-15 digits, first digit non-zero.
// Matches what Twilio reports for an inbound call's caller id.
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export function PhoneEntryScreen({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  onSubmit: (phoneNumber: string) => void;
}) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const normalized = phoneNumber.replace(/[\s()-]/g, "");
  const isValid = E164_REGEX.test(normalized);

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
              Your number
            </h1>
            <Badge
              variant="secondary"
              className="font-mono text-[10px] uppercase tracking-wider"
            >
              Desktop
            </Badge>
          </div>
          <p className="mb-7 max-w-80 text-sm text-ash">
            Add the phone number you call Vox from, so it recognizes you and
            your tasks show up here too. Anyone who later enters this number
            will inherit its history — only use a number that's yours.
          </p>
          <Card className="shadow-key w-full border-0 bg-transparent p-1.5">
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (isValid) onSubmit(normalized);
              }}
            >
              <Input
                type="tel"
                placeholder="+1 555 000 1234"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                disabled={busy}
              />
              <Button
                type="submit"
                className="shadow-btn-lift h-11 w-full"
                disabled={busy || !isValid}
              >
                {busy ? "Saving…" : "Continue"}
              </Button>
              {error ? (
                <p className="text-center text-xs text-coral-pulse">
                  {error}
                </p>
              ) : phoneNumber.trim() && !isValid ? (
                <p className="text-center text-xs text-ash">
                  Include the country code with a leading +, e.g. +15550001234
                </p>
              ) : null}
            </form>
          </Card>
        </div>
      </div>
    </main>
  );
}
