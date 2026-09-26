import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type LocalEvent } from "@/lib/tauri";

export function ActivityLogs() {
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    // Load initial events from recent command history or buffer
    void api
      .getLocalEvents()
      .then((initial) => {
        if (initial && initial.length > 0) {
          setEvents(initial);
        }
      })
      .catch(() => undefined);

    // Listen to real-time events emitted by the backend
    void listen<LocalEvent>("local-agent-event", (event) => {
      setEvents((prev) => [...prev.slice(-150), event.payload]);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Auto-scroll to bottom on new event if user hasn't scrolled up
  useEffect(() => {
    if (!isScrolledUp && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, isScrolledUp]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setIsScrolledUp(!atBottom);
  };

  if (events.length === 0) return null;

  return (
    <div
      aria-label="Activity Logs"
      className="pointer-events-auto absolute top-10 right-4 z-30 flex max-h-[55vh] w-[320px] flex-col overflow-hidden bg-transparent select-text opacity-45 transition-opacity duration-300 hover:opacity-85"
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20"
      >
        <div className="flex flex-col space-y-1.5">
          {events.map((ev) => {
            if (ev.kind === "command") {
              const cleanCmd = ev.text.startsWith("$ ")
                ? ev.text.slice(2)
                : ev.text;
              return (
                <div
                  key={ev.id}
                  className="font-mono text-[11px] leading-relaxed break-words text-zinc-300"
                >
                  <span className="text-[9.5px] text-zinc-500 mr-1.5 select-none font-sans">
                    {ev.timestamp}
                  </span>
                  <span className="text-[#ff6363] font-semibold mr-1 select-none">
                    $
                  </span>
                  <span className="font-medium text-white">{cleanCmd}</span>
                </div>
              );
            }

            if (ev.kind === "output") {
              return (
                <div
                  key={ev.id}
                  className="font-mono text-[10.5px] leading-snug break-words text-zinc-400 pl-2 border-l border-white/15 ml-0.5"
                >
                  <span className="text-[9.5px] text-zinc-600/70 mr-1 select-none font-sans">
                    {ev.timestamp}
                  </span>
                  <span>{ev.text}</span>
                </div>
              );
            }

            if (ev.kind === "success") {
              return (
                <div
                  key={ev.id}
                  className="font-mono text-[10.5px] leading-relaxed break-words text-emerald-400/90"
                >
                  <span className="text-[9.5px] text-zinc-600/70 mr-1.5 select-none font-sans">
                    {ev.timestamp}
                  </span>
                  <span className="mr-1 text-emerald-400 select-none">✓</span>
                  <span>{ev.text}</span>
                </div>
              );
            }

            if (ev.kind === "error") {
              return (
                <div
                  key={ev.id}
                  className="font-mono text-[10.5px] leading-relaxed break-words text-[#ff6363]"
                >
                  <span className="text-[9.5px] text-zinc-600/70 mr-1.5 select-none font-sans">
                    {ev.timestamp}
                  </span>
                  <span className="mr-1 select-none">✗</span>
                  <span>{ev.text}</span>
                </div>
              );
            }

            if (ev.kind === "system") {
              return (
                <div
                  key={ev.id}
                  className="font-mono text-[10.5px] leading-relaxed break-words text-zinc-500"
                >
                  <span className="text-[9.5px] text-zinc-600/70 mr-1.5 select-none font-sans">
                    {ev.timestamp}
                  </span>
                  <span className="text-zinc-600 mr-1 select-none">→</span>
                  <span>{ev.text}</span>
                </div>
              );
            }

            // Default: status or info
            return (
              <div
                key={ev.id}
                className="font-mono text-[10.5px] leading-relaxed break-words text-zinc-500 italic"
              >
                <span className="text-[9.5px] text-zinc-600/70 mr-1.5 select-none font-sans">
                  {ev.timestamp}
                </span>
                <span className="text-zinc-600 mr-1 select-none">•</span>
                <span>{ev.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
