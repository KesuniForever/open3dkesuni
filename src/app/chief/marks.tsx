// Two small marks for checklists ("can do" / "locked"), drawn like the icons in components/Icon.tsx.
const svg = (d: string, size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={d} />
  </svg>
);

export const Tick = ({ size = 14 }: { size?: number }) => svg("M4 12.5 9.5 18 20 6", size);
export const Lock = ({ size = 14 }: { size?: number }) =>
  svg("M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-7A1.5 1.5 0 0 1 6.5 11zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11", size);
