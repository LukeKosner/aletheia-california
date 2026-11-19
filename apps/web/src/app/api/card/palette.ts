import { readFile } from "node:fs/promises";
import { join } from "node:path";

// OG rendering cannot resolve CSS variables or oklch. Read the actual theme
// tokens and convert them to supported sRGB; never introduce another palette.
export async function cardPalette() {
  const css = await readFile(join(process.cwd(), "src/app/globals.css"), "utf8");
  const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
  const token = (name: string) => {
    const match = new RegExp(`--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(light);
    if (!match) throw new Error("Missing card theme token");
    const [l, c, hue] = match.slice(1).map(Number);
    const a = c * Math.cos(hue * Math.PI / 180), b = c * Math.sin(hue * Math.PI / 180);
    const ll = (l + .3963377774 * a + .2158037573 * b) ** 3;
    const mm = (l - .1055613458 * a - .0638541728 * b) ** 3;
    const ss = (l - .0894841775 * a - 1.291485548 * b) ** 3;
    const channels = [4.0767416621 * ll - 3.3077115913 * mm + .2309699292 * ss, -1.2684380046 * ll + 2.6097574011 * mm - .3413193965 * ss, -.0041960863 * ll - .7034186147 * mm + 1.707614701 * ss];
    return "#" + channels.map((v) => Math.round(Math.min(1, Math.max(0, v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055)) * 255).toString(16).padStart(2, "0")).join("");
  };
  return { paper: token("paper"), ink: token("ink"), muted: token("muted-foreground"), border: token("border") };
}
