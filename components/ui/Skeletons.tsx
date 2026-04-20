'use client';

const shimmer = `
@keyframes skel-shimmer {
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
`;

const skelStyle = {
  background: 'linear-gradient(90deg, var(--bg2) 25%, var(--bg3) 50%, var(--bg2) 75%)',
  backgroundSize: '800px 100%',
  animation: 'skel-shimmer 1.5s infinite',
  borderRadius: 4,
};

function Bar({ w = '100%', h = 12, mb = 6 }: { w?: string | number; h?: number; mb?: number }) {
  return <div style={{ ...skelStyle, width: w, height: h, marginBottom: mb }} />;
}

function KPISkeleton({ count = 6 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 1, background: 'var(--line)', borderRadius: 6, overflow: 'hidden', marginBottom: 20 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background: 'var(--bg1)', padding: '14px 12px' }}>
          <Bar w="60%" h={8} mb={8} />
          <Bar w="50%" h={20} mb={6} />
          <Bar w="80%" h={8} />
        </div>
      ))}
    </div>
  );
}

function PanelSkeleton({ rows = 5, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
      {title && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between' }}>
          <Bar w={120} h={10} mb={0} />
          <Bar w={60} h={10} mb={0} />
        </div>
      )}
      <div style={{ padding: 14 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <Bar w="40%" h={10} mb={0} />
            <Bar w="20%" h={10} mb={0} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between' }}>
        <Bar w={180} h={10} mb={0} />
        <div style={{ display: 'flex', gap: 6 }}><Bar w={60} h={10} mb={0} /><Bar w={60} h={10} mb={0} /></div>
      </div>
      <div style={{ padding: 14 }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
          {Array.from({ length: cols }).map((_, i) => <Bar key={i} w="70%" h={8} mb={0} />)}
        </div>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            {Array.from({ length: cols }).map((_, c) => <Bar key={c} w={c === 0 ? '90%' : '60%'} h={10} mb={0} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background: 'var(--bg1)', border: '1px solid var(--line)', borderLeft: '3px solid var(--line)', borderRadius: 4, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <Bar w="60%" h={12} mb={0} />
            <Bar w={50} h={10} mb={0} />
          </div>
          <Bar w="90%" h={9} mb={4} />
          <Bar w="70%" h={9} />
        </div>
      ))}
    </div>
  );
}

// ─── Page-Level Skeletons ────────────────────────────────
export function OverviewSkeleton() {
  return (
    <div style={{ padding: 18 }}>
      <style>{shimmer}</style>
      <Bar w={200} h={8} mb={12} />
      <KPISkeleton count={6} />
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14 }}>
        <AlertSkeleton count={3} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PanelSkeleton rows={6} />
          <PanelSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}

export function CostIntelSkeleton() {
  return (
    <div style={{ padding: 18 }}>
      <style>{shimmer}</style>
      <Bar w={240} h={8} mb={12} />
      <KPISkeleton count={4} />
      <TableSkeleton rows={10} cols={7} />
    </div>
  );
}

export function SupplierSkeleton() {
  return (
    <div style={{ padding: 18 }}>
      <style>{shimmer}</style>
      <Bar w={200} h={8} mb={12} />
      <KPISkeleton count={5} />
      <div style={{ display: 'grid', gridTemplateColumns: '5fr 3fr', gap: 14 }}>
        <PanelSkeleton rows={8} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PanelSkeleton rows={7} />
          <PanelSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}

export function RFQSkeleton() {
  return (
    <div style={{ padding: 18 }}>
      <style>{shimmer}</style>
      <Bar w={180} h={8} mb={12} />
      <KPISkeleton count={4} />
      <TableSkeleton rows={12} cols={4} />
    </div>
  );
}

export function GenericPageSkeleton() {
  return (
    <div style={{ padding: 18 }}>
      <style>{shimmer}</style>
      <Bar w={200} h={8} mb={12} />
      <KPISkeleton count={4} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <PanelSkeleton rows={6} />
        <PanelSkeleton rows={6} />
      </div>
    </div>
  );
}
