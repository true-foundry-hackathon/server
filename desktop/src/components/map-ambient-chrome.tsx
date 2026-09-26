export function MapAmbientChrome() {
  return (
    <>
      <div
        className="sign-in-glow pointer-events-none absolute -left-28 -top-32 z-[3] h-[30rem] w-[30rem] opacity-55"
        aria-hidden
      />
      <div
        className="sign-in-noise pointer-events-none absolute inset-0 z-[3]"
        aria-hidden
      />
      <div
        className="vox-map-noise pointer-events-none absolute inset-0 z-[3]"
        aria-hidden
      />
      <div
        className="vox-map-vignette pointer-events-none absolute inset-0 z-[3]"
        aria-hidden
      />
      <div
        className="vox-map-corner-blur pointer-events-none absolute inset-0 z-[3]"
        aria-hidden
      />
    </>
  );
}
