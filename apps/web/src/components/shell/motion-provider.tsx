"use client";

import { MotionConfig } from "motion/react";

/**
 * JS-driven animations from the `motion` library skip transforms and layout
 * animation when the visitor prefers reduced motion. CSS animations are
 * handled by the prefers-reduced-motion block in globals.css.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
