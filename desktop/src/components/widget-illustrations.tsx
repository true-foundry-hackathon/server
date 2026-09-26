/** Film-grain texture, layered above a widget's content. */
export function WidgetNoise() {
  return (
    <span
      aria-hidden
      className="widget-noise pointer-events-none absolute inset-0 rounded-[inherit]"
    />
  );
}
