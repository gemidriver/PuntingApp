"use client";
import ClientVersionCheck from "./client-version-check";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ClientVersionCheck />
      {children}
    </>
  );
}
