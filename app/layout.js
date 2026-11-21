const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const TITLE = 'NOIR — "Transit"';
const DESCRIPTION =
  "A man returns, one year later, to search a rain-soaked apartment building for his missing wife — solving the puzzles of his own grief before the last train leaves without him.";

export const metadata = {
  // Set NEXT_PUBLIC_SITE_URL (e.g. https://example.com) so the share image resolves to an absolute URL.
  // On Vercel, Next falls back to the deployment URL when this is unset.
  ...(process.env.NEXT_PUBLIC_SITE_URL ? { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL) } : {}),
  title: TITLE,
  description: DESCRIPTION,
  icons: {
    icon: [
      { url: BASE + "/favicon.svg", type: "image/svg+xml" },
      { url: BASE + "/favicon.png", type: "image/png", sizes: "64x64" },
    ],
    apple: BASE + "/apple-touch-icon.png",
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    images: [{ url: BASE + "/art/og.jpg", width: 1200, height: 630, alt: "A man in a dark coat looks up at a rain-soaked apartment building at night." }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [BASE + "/art/og.jpg"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
