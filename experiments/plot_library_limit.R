#!/usr/bin/env Rscript
# What a spectral library can and cannot settle about a Sentinel-2 pixel.
#
# Input:  experiments/data/*.csv, written by spectral_response_and_offset.py
# Output: experiments/figures/library_limit.{svg,pdf,tiff}
#
# CORE CONCLUSION. The convolution onto Sentinel-2 bands is correct, and a
# leaf-level library still cannot identify a canopy pixel. The mismatch is
# structural, not a classification error and not a brightness offset.
#
# EVIDENCE CHAIN, one question per panel:
#   a  is the machinery right?            hyperspectral leaf, the response
#                                         functions, and the seven readings
#                                         they integrate to            (hero)
#   b  does the difference survive the     unit-normalised spectra, which is
#      only thing SAM compares?            exactly what the angle sees
#   c  why does it survive?                the canopy-to-leaf ratio is not
#                                         flat: 0.49 in the NIR, 1.70 in red
#   d  what does that cost?                the angle ranks the wrong class
#                                         closest to the soybean reference
#
# Panel c is the mechanism the other three depend on. A constant ratio would be
# pure brightness, and SAM would return zero; the ratio varies band by band
# because soil raises the red while gaps and shadow lower the NIR.

suppressPackageStartupMessages({
  library(ggplot2)
  library(patchwork)
  library(dplyr)
  library(readr)
})

here <- function(...) file.path("experiments", ...)
dir.create(here("figures"), showWarnings = FALSE, recursive = TRUE)

PUB_FONT <- "Arial"
stopifnot(any(systemfonts::system_fonts()$family == PUB_FONT))

theme_set(
  theme_classic(base_size = 6.5, base_family = PUB_FONT) +
    theme(
      axis.line = element_line(linewidth = 0.35, colour = "black"),
      axis.ticks = element_line(linewidth = 0.35, colour = "black"),
      axis.text = element_text(size = 5.8, colour = "black"),
      legend.title = element_text(size = 6.2),
      legend.text = element_text(size = 5.8),
      legend.key.size = unit(3, "mm"),
      plot.title = element_text(size = 7, face = "bold"),
      plot.subtitle = element_text(size = 6, colour = "grey30"),
      plot.tag = element_text(size = 8, face = "bold"),
      panel.grid = element_blank()
    )
)

save_pub_r <- function(plot, filename, width_mm = 183, height_mm = 120, dpi = 600) {
  w <- width_mm / 25.4; h <- height_mm / 25.4
  svglite::svglite(paste0(filename, ".svg"), width = w, height = h,
                   system_fonts = list(sans = PUB_FONT))
  print(plot); dev.off()
  grDevices::cairo_pdf(paste0(filename, ".pdf"), width = w, height = h,
                       family = PUB_FONT)
  print(plot); dev.off()
  ragg::agg_tiff(paste0(filename, ".tiff"), width = w, height = h,
                 units = "in", res = dpi)
  print(plot); dev.off()
  # A web copy as well. The TIFF is the archival master and runs to tens of
  # megabytes, which no forum or issue tracker will inline; 200 dpi keeps the
  # 5.8 pt type legible on screen at a size that uploads.
  ragg::agg_png(paste0(filename, ".png"), width = w, height = h,
                units = "in", res = 200)
  print(plot); dev.off()
}

# The MapBiomas hues, darkened along their own hue until each clears 3:1 on
# white. They are made to fill map polygons; the palest measures 1.1:1, which
# no line can be followed at.
contrast_on_white <- function(hex) {
  rgb <- col2rgb(hex) / 255
  lin <- ifelse(rgb <= 0.03928, rgb / 12.92, ((rgb + 0.055) / 1.055)^2.4)
  1.05 / (0.2126 * lin[1] + 0.7152 * lin[2] + 0.0722 * lin[3] + 0.05)
}
darken_to_contrast <- function(hex, target = 3.0) {
  while (contrast_on_white(hex) < target) {
    h <- rgb2hsv(col2rgb(hex))
    hex <- hsv(h[1], min(1, h[2] * 1.12), h[3] * 0.98)
    if (h[3] < 0.06) break
  }
  hex
}
legend_tbl <- read_csv(here("data", "class_legend.csv"), show_col_types = FALSE) |>
  rowwise() |> mutate(plot_colour = darken_to_contrast(color)) |> ungroup()
class_colours <- setNames(legend_tbl$plot_colour, legend_tbl$class_name)

LEAF <- "soybean leaf (EcoSIS)"
LEAF_COL <- "#111111"
series_colours <- c(class_colours, setNames(LEAF_COL, LEAF))

# ------------------------------------------------ a. the machinery, in full
hyper <- read_csv(here("data", "library_hyperspectral.csv"), show_col_types = FALSE)
curves <- read_csv(here("data", "srf_curves.csv"), show_col_types = FALSE)
convolved <- read_csv(here("data", "library_reference.csv"), show_col_types = FALSE)

# The response curves are drawn on the same axis, scaled to the lower fifth of
# the range. They are context for where each reading comes from, not a second
# quantity to be read off, so they carry no axis of their own.
srf_scale <- 0.09
pa <- ggplot() +
  geom_area(data = curves,
            aes(wavelength_nm, response * srf_scale, group = band),
            fill = "#4a6fa5", alpha = 0.16, colour = NA) +
  geom_line(data = hyper, aes(wavelength_nm, reflectance),
            linewidth = 0.4, colour = LEAF_COL) +
  geom_point(data = convolved, aes(wavelength_nm, reflectance),
             size = 1.6, shape = 21, fill = "#c0392b", colour = "white",
             stroke = 0.4) +
  annotate("text", x = 1150, y = 0.030, label = "Sentinel-2 response functions",
           size = 1.9, colour = "#4a6fa5", hjust = 0) +
  annotate("text", x = 1150, y = 0.545, label = "1,131 soybean leaf spectra, mean",
           size = 1.9, colour = LEAF_COL, hjust = 0) +
  annotate("text", x = 1150, y = 0.495, label = "convolved to the seven bands",
           size = 1.9, colour = "#c0392b", hjust = 0) +
  scale_x_continuous(breaks = seq(500, 2500, 500)) +
  labs(x = "Wavelength (nm)", y = "Reflectance (dimensionless)",
       title = "The convolution is correct",
       subtitle = "A flat spectrum returns itself in every band to 2e-16")

# ------------------------------------- b. what the angle actually compares
shapes <- read_csv(here("data", "unit_shapes.csv"), show_col_types = FALSE) |>
  mutate(is_leaf = series == LEAF)

pb <- ggplot(shapes, aes(wavelength_nm, unit_reflectance,
                         colour = series, group = series)) +
  geom_line(aes(linewidth = is_leaf)) +
  geom_point(size = 0.7) +
  scale_colour_manual(values = series_colours, name = NULL) +
  scale_linewidth_manual(values = c(`FALSE` = 0.4, `TRUE` = 0.8), guide = "none") +
  scale_x_continuous(breaks = c(500, 1000, 1500, 2000)) +
  labs(x = "Wavelength (nm)", y = "Unit-normalised reflectance",
       title = "Scale removed, shape remains",
       subtitle = "SAM compares these, not the raw magnitudes") +
  # Placed inside the panel this legend sat on the converging tails at the
  # right edge. Collected to the foot of the figure instead, where it also
  # serves panel d rather than being drawn twice.
  guides(colour = guide_legend(nrow = 1))

# ---------------------------------------------------- c. the mechanism
gap <- read_csv(here("data", "leaf_vs_canopy.csv"), show_col_types = FALSE) |>
  filter(class_name == "Soybean") |>
  arrange(wavelength_nm) |>
  mutate(band = factor(band, levels = band))

pc <- ggplot(gap, aes(band, canopy_over_leaf)) +
  geom_hline(yintercept = 1, linewidth = 0.3, colour = "grey60") +
  geom_segment(aes(xend = band, y = 1, yend = canopy_over_leaf),
               linewidth = 0.4, colour = "grey55") +
  geom_point(size = 1.8, colour = class_colours[["Soybean"]]) +
  geom_text(aes(label = sprintf("%.2f", canopy_over_leaf)),
            vjust = -0.9, size = 1.9) +
  scale_y_continuous(limits = c(0.35, 1.95)) +
  labs(x = NULL, y = "Canopy reflectance / leaf reflectance",
       title = "The ratio is not flat",
       subtitle = "Soil raises the red; gaps and shadow lower the NIR")

# --------------------------------------------------- d. the consequence
angles <- read_csv(here("data", "spectral_angles.csv"), show_col_types = FALSE) |>
  filter(convention == "offset applied") |>
  mutate(class_name = reorder(class_name, angle_rad),
         is_soy = class_name == "Soybean")

pd <- ggplot(angles, aes(angle_rad, class_name, colour = class_name)) +
  geom_segment(aes(xend = 0, yend = class_name), linewidth = 0.4) +
  geom_point(size = 2) +
  geom_text(aes(label = sprintf("%.3f", angle_rad)), hjust = -0.4, size = 1.9,
            colour = "black") +
  scale_colour_manual(values = class_colours, guide = "none") +
  scale_x_continuous(limits = c(0, 0.42)) +
  labs(x = "Spectral angle to the soybean leaf reference (rad)", y = NULL,
       title = "The ranking is not identification",
       subtitle = "Soybean is not the class closest to the soybean library")

fig <- (pa | pb) / (pc | pd) +
  plot_layout(heights = c(1, 0.85), guides = "collect") +
  plot_annotation(tag_levels = "a") &
  theme(legend.position = "bottom", legend.box = "horizontal",
        legend.margin = margin(t = 1, b = 0))

save_pub_r(fig, here("figures", "library_limit"),
           width_mm = 183, height_mm = 132)

cat("written:\n")
for (ext in c("svg", "pdf", "tiff")) {
  f <- here("figures", paste0("library_limit.", ext))
  cat(sprintf("  %s  %.1f KB\n", f, file.size(f) / 1024))
}
