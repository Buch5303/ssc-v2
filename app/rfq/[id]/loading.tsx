function RFQDetailSkeleton() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="h-4 bg-muted animate-pulse rounded mb-6 w-32"></div>
      <div className="h-96 bg-muted animate-pulse rounded"></div>
      <div className="h-4 bg-muted animate-pulse rounded mt-4 w-3/4"></div>
    </div>
  );
}

export default function Loading() {
  return <RFQDetailSkeleton />;
}