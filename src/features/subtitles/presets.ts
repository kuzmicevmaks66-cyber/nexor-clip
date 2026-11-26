import type { CSSProperties } from "react";
import type { SubtitleStyle } from "@/types";

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Arial",
  fontSize: 64,
  color: "#FFFFFF",
  outlineColor: "#000000",
  outlineWidth: 4,
  shadow: true,
  position: "bottom",
  animation: "pop",
  bold: true,
  uppercase: false,
};

/** Шрифты, которые есть в стандартной установке Windows (FFmpeg/libass берёт их из системы). */
export const FONTS = ["Arial", "Segoe UI", "Impact", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Calibri", "Bahnschrift"];

// Цвет текста субтитров — это контент пользователя, не UI, поэтому палитра шире.
export const TEXT_COLORS = ["#FFFFFF", "#000000", "#FFE000", "#FF3B30", "#34C759", "#00C2FF"];

export const ANIMATIONS: { value: SubtitleStyle["animation"]; label: string }[] = [
  { value: "none", label: "Без анимации" },
  { value: "fade", label: "Плавно" },
  { value: "pop", label: "Pop" },
  { value: "word", label: "По словам" },
];

export const STYLE_PRESETS: { name: string; style: Partial<SubtitleStyle> }[] = [
  { name: "Классика", style: { fontFamily: "Arial", color: "#FFFFFF", outlineColor: "#000000", outlineWidth: 4, shadow: true, animation: "none", uppercase: false } },
  { name: "Shorts", style: { fontFamily: "Impact", color: "#FFFFFF", outlineColor: "#000000", outlineWidth: 6, shadow: true, animation: "pop", uppercase: true, position: "middle" } },
  { name: "Караоке", style: { fontFamily: "Segoe UI", color: "#FFE000", outlineColor: "#000000", outlineWidth: 4, animation: "word", uppercase: false } },
  { name: "Минимал", style: { fontFamily: "Segoe UI", color: "#FFFFFF", outlineColor: "#000000", outlineWidth: 0, shadow: true, animation: "fade", bold: false } },
];

/** CSS для предпросмотра. fontSize задан в пикселях при высоте кадра 1080. */
export function subtitleCss(s: SubtitleStyle, frameHeight: number): CSSProperties {
  const scale = frameHeight / 1080;
  const ow = s.outlineWidth * scale;
  return {
    fontFamily: `"${s.fontFamily}", Arial, sans-serif`,
    fontSize: Math.max(8, s.fontSize * scale),
    fontWeight: s.bold ? 700 : 400,
    textTransform: s.uppercase ? "uppercase" : "none",
    color: s.color,
    WebkitTextStroke: ow > 0 ? `${ow * 2}px ${s.outlineColor}` : undefined,
    paintOrder: "stroke fill",
    textShadow: s.shadow ? `0 ${3 * scale}px ${6 * scale}px rgba(0,0,0,0.8)` : "none",
    top: s.position === "top" ? "10%" : s.position === "middle" ? "50%" : undefined,
    bottom: s.position === "bottom" ? "12%" : undefined,
    transform: s.position === "middle" ? "translateY(-50%)" : undefined,
  };
}
