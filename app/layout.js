export const metadata = {
  title: 'NOIR — "Transit"',
  description:
    'A man returns, one year later, to search a rain-soaked apartment building for his missing wife — solving the puzzles of his own grief before the last train leaves without him.',
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
