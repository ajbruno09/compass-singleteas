// The product name, with what it is (SToMS) and the version of this build under it.
export function Brand({ size = 28, light = false }: { size?: number; light?: boolean }) {
  return (
    <div className="brandmark">
      <img src="/logo-mark.png" alt="" width={size} height={size} style={{ borderRadius: size * 0.28 }} />
      <div>
        <b style={light ? { color: '#fff' } : undefined}>Compass</b>
        <span className="ver" style={light ? { color: 'rgba(255,255,255,.75)' } : undefined}>SToMS v{__APP_VERSION__}</span>
      </div>
    </div>
  );
}
