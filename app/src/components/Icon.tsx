const P: Record<string, string> = {
  wrench: 'M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.6 2.6-2.4-.6-.6-2.4z',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  clip: 'M8 4h8v3H8zM6 5h12v16H6zM9 12h6M9 16h4',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0zM8 21h8',
  truck: 'M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3',
  tag: 'M20 12l-8 8-9-9V3h8zM7.5 7.5h.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6L6 18M6 6l12 12',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  check: 'M20 6L9 17l-5-5',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  camera: 'M4 7h3l2-3h6l2 3h3v13H4zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M21 21l-4.3-4.3',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  back: 'M15 18l-6-6 6-6',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  pin: 'M12 17v5M9 3h6l-1 6 3 4H7l3-4z',
  cart: 'M3 4h2l2.4 11h10.2l2-8H6.2M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01',
  chev: 'M6 9l6 6 6-6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  finger: 'M12 11a3 3 0 0 0-3 3c0 2-.5 4-1.5 6M12 7a7 7 0 0 0-7 7M12 3a11 11 0 0 1 9 5M17 20c.5-2 .7-4 .7-6a5.7 5.7 0 0 0-1-3M12 14c0 3-.5 5.5-1.7 7.5',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6M5 21h14M12 3v2M4.5 6.5L6 8M19.5 6.5L18 8',
  note: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8M8 8h6M8 12h4M8 16h2M20.5 10.5l-6 6-3 .8.8-3 6-6a1.4 1.4 0 0 1 2.2 2.2',
  calbars: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4M8 18v-3M12 18v-5M16 18v-7',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  chat: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 8h6M9 11h6M9 8c4 0 4 5 0 5l4 3',
  trenddown: 'M3 7l6 6 4-4 8 8M21 11v6h-6',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  siren2: 'M6 19v-5a6 6 0 0 1 12 0v5M4 22h16M12 2v2M3.5 5.5l1.5 1.5M20.5 5.5L19 7M9 14a3 3 0 0 1 3-3',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'
};
export function Icon({ name, size = 16, stroke = 1.7 }: { name: keyof typeof P | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ''} />
    </svg>
  );
}
