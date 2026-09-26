import { useState } from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function AccountMenu({
  accountLabel,
  onSignOut,
}: {
  accountLabel: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const displayName = accountLabel.replace(/@.*/, "");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex size-7 items-center justify-center rounded-full bg-graphite text-pure-white transition hover:brightness-110",
          open && "ring-2 ring-white/20",
        )}
      >
        <UserRound className="size-3.5" strokeWidth={1.75} />
      </button>
      {open ? (
        <Card className="shadow-key absolute right-0 top-full z-[999] mt-3 w-60 gap-3 border-0 p-3.5">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-wide text-smoke">
              Signed In
            </p>
            <p className="truncate font-mono text-[12.5px] text-pure-white">
              {displayName}
            </p>
          </div>
          <Separator />
          <Button
            variant="destructive"
            className="h-8 w-full text-coral-pulse"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign Out
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
