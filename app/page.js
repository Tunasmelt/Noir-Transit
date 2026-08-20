"use client";
import dynamic from "next/dynamic";

// ssr:false is required — the game touches document/window/canvas/WebGL
// directly and was never written to run outside a browser.
const NoirGame = dynamic(() => import("./game/NoirGame"), { ssr: false });

export default function Page() {
  return <NoirGame />;
}
