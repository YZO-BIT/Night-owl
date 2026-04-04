"use client";

import { useEffect, useState } from "react";

export default function ClientHydrationGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="min-h-screen w-full" aria-hidden="true" />;
  }

  return <>{children}</>;
}
