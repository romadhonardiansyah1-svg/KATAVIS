/** @type {import('next').NextConfig} */
const nextConfig = {
  // Izinkan akses dev resources dan HMR saat dibuka dari HP lewat IP lokal
  allowedDevOrigins: [
    "172.16.67.19",
    "localhost:3000",
    "127.0.0.1:3000",
  ],
};

export default nextConfig;
