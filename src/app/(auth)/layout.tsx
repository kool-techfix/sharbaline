import type { ReactNode } from "react";
import { BrandCard } from "@/components/BrandCard";
import { ConnectionProvider, LiveConnectionChip } from "@/components/connection/ConnectionProvider";
import { serverEnv } from "@/server/config/env";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider>
      <BrandCard hospitalName={serverEnv().HOSPITAL_NAME} status={<LiveConnectionChip />}>
        {children}
      </BrandCard>
    </ConnectionProvider>
  );
}
