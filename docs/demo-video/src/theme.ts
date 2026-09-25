import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";

const inter = loadInter("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] });
const serif = loadSerif("italic", { weights: ["400"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const FONT = {
  sans: `${inter.fontFamily}, system-ui, sans-serif`,
  serif: `${serif.fontFamily}, Georgia, serif`,
  mono: `${mono.fontFamily}, ui-monospace, monospace`,
};

/** The app's own light theme tokens, copied from app/app/globals.css. */
export const UI = {
  background: "#ffffff",
  foreground: "#0d0d0d",
  muted: "#f4f4f4",
  mutedForeground: "#6b6b6b",
  accent: "#ececec",
  border: "#e5e5e5",
  sidebar: "#f9f9f9",
  destructive: "#d92d20",
};

/** File type tile colours, copied from app/components/file-icon.tsx. */
export const KIND = {
  pdf: "#e5484d",
  xlsx: "#12a150",
  docx: "#2b6cd8",
  pptx: "#e8710a",
  txt: "#5d5d5d",
  web: "#0d0d0d",
} as const;
export type Kind = keyof typeof KIND;

/** The stage around the product: near black, one warm accent. */
export const STAGE = {
  bg: "#09090b",
  ink: "#fafafa",
  dim: "#a1a1aa",
  faint: "#3f3f46",
  accent: "#ffb224",
  accentSoft: "rgba(255,178,36,0.14)",
  danger: "#ff5a4f",
  good: "#3ddc84",
};

export const FPS = 30;
export const W = 1920;
export const H = 1080;
