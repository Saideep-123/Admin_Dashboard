import "./globals.css";

export const metadata = {
  title: "Orders Dashboard",
  description: "Admin Orders Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0b0c0f" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>{children} <script
  dangerouslySetInnerHTML={{
    __html: `
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("/service-worker.js");
        });
      }
    `
  }}
/>
</body>
    </html>
  );
}
