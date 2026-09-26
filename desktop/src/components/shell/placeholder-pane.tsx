export function PlaceholderPane({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <p className="font-mono text-[12px] text-white/40">{label} — coming soon</p>
    </div>
  );
}
