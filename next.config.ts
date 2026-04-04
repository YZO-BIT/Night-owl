import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
	outputFileTracingRoot: path.resolve(__dirname),
	reactStrictMode: true,
};

export default nextConfig;
