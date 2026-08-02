import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Axora Procurement",
    short_name: "Axora",
    description: "Secure multi-company procurement coordination from request to verified record.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#0B2D52",
    icons: [
      { src: "/brand/axora-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/axora-mark-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
