// Small inline line icons (24px grid, stroke = currentColor). No icon package: a few paths are enough.
const PATHS = {
  overview: "M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z",
  orders: "M9 3h6v3H9zM7 4.5H5.5A1.5 1.5 0 0 0 4 6v13.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H17M8 11h8M8 15h5",
  calculator: "M6 2.5h12A1.5 1.5 0 0 1 19.5 4v16a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5zM8 6.5h8v3H8zM8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01",
  chain: "M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.7 1.7M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.7-1.7",
  review: "M14 2.5H6A1.5 1.5 0 0 0 4.5 4v16A1.5 1.5 0 0 0 6 21.5h12a1.5 1.5 0 0 0 1.5-1.5V8L14 2.5zM14 2.5V8h5.5M8 13h8M8 17h6",
  plus: "M12 5v14M5 12h14",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  wallet: "M3 7.5A2.5 2.5 0 0 1 5.5 5H19v4M3 7.5v10A2.5 2.5 0 0 0 5.5 20H21v-5M3 7.5A2.5 2.5 0 0 0 5.5 10H21v5h-4a2.5 2.5 0 0 1 0-5",
  printer: "M6 9V3h12v6M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-6A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H18M6 14h12v7H6z",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  tag: "M3 12V3h9l9 9-9 9zM7.5 7.5h.01",
  wrench: "M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 1.3-1.3a4 4 0 0 1-5-5L3 8.4 5.6 6l3.3 3.3a4 4 0 0 1 5-5z",
  check: "M4 12.5 9.5 18 20 6",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM8.5 12l2.5 2.5 4.5-5",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "m9 6 6 6-6 6",
  arrow: "M7 17 17 7M8 7h9v9",
  layers: "m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 16.5l9 5 9-5",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The Open3DKesuni mark: a lime tile with stacked layers (a print, layer by layer). */
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="layers" size={Math.round(size * 0.58)} />
    </span>
  );
}
