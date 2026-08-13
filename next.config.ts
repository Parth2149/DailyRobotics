import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Supabase Storage public bucket images
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Pollinations AI fallback images
        protocol: 'https',
        hostname: 'image.pollinations.ai',
      },
      {
        // Any other HTTPS images (open graph scrapes)
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
