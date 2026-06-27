import type { Layout } from "plotly.js-dist-min";

export const plotColors = {
  bg: "#f7f7f8",
  surface: "#ffffff",
  grid: "#ececf1",
  text: "#353740",
  muted: "#8e8ea0",
  accent: "#10a37f",
  success: "#10a37f",
  danger: "#ef4146",
  warning: "#f59e0b",
};

export const basePlotLayout: Partial<Layout> = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { family: "Inter, system-ui, sans-serif", color: plotColors.text, size: 12 },
  margin: { l: 48, r: 24, t: 32, b: 48 },
  hoverlabel: {
    bgcolor: "#ffffff",
    bordercolor: "#e5e5e5",
    font: { color: "#0d0d0d", size: 12 },
  },
};

export const axisStyle = {
  gridcolor: plotColors.grid,
  zerolinecolor: plotColors.grid,
  linecolor: "#d9d9e3",
  tickcolor: plotColors.muted,
};
